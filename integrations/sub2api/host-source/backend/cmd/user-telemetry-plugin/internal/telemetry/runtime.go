package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	public "github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const MaxResponseBytes = 2 * 1024 * 1024
const RequestTimeout = 5 * time.Second

// Source is deliberately only a telemetry read; no credential, KV or transport
// APIs are exposed to business code. The adapter verifies the host before SetHost.
type Source interface {
	Read(context.Context, public.Query) ([]byte, error)
}

type Summary struct {
	Ready      bool `json:"ready"`
	Configured bool `json:"configured"`
}

type Runtime struct {
	mu          sync.Mutex
	config      Config
	source      Source
	serverReady bool
	generation  uint64
	sequence    uint64
	active      map[uint64]context.CancelFunc
}

func New() *Runtime {
	return &Runtime{config: Config{AllowedUserIDs: []string{}, Timezone: "Asia/Shanghai", PageSize: 100}, active: make(map[uint64]context.CancelFunc)}
}

func (r *Runtime) invalidateLocked() {
	r.generation++
	for _, cancel := range r.active {
		cancel()
	}
}

func (r *Runtime) SetServerReady(ready bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.invalidateLocked()
	r.serverReady = ready
}

func (r *Runtime) SetHost(source Source) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.invalidateLocked()
	r.source = source
}

func (r *Runtime) Apply(ctx context.Context, raw []byte) error {
	c, _, err := ParseConfig(raw)
	if err != nil {
		return status.Error(codes.InvalidArgument, err.Error())
	}
	if err := ctx.Err(); err != nil {
		return status.FromContextError(err).Err()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return status.FromContextError(err).Err()
	}
	r.invalidateLocked()
	r.config = c
	return nil
}

func (r *Runtime) Summary() Summary {
	r.mu.Lock()
	defer r.mu.Unlock()
	configured := len(r.config.AllowedUserIDs) > 0
	return Summary{Ready: r.serverReady && r.source != nil && configured, Configured: configured}
}

// ServerReady is separate from query readiness: lifecycle health must allow the
// host to finish configuration/InitHostServices after gRPC registration.
func (r *Runtime) ServerReady() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.serverReady }

func (r *Runtime) Query(ctx context.Context, raw []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	r.mu.Lock()
	if !r.serverReady || r.source == nil || len(r.config.AllowedUserIDs) == 0 {
		r.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "telemetry is not ready")
	}
	c := r.config
	c.AllowedUserIDs = append([]string(nil), c.AllowedUserIDs...)
	source, generation := r.source, r.generation
	r.sequence++
	sequence := r.sequence
	r.active[sequence] = cancel
	r.mu.Unlock()
	defer func() { r.mu.Lock(); delete(r.active, sequence); r.mu.Unlock() }()
	q, err := PrepareQuery(raw, c, time.Now())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	payload, err := source.Read(ctx, q)
	if err != nil {
		if ctx.Err() != nil {
			return nil, status.FromContextError(ctx.Err()).Err()
		}
		// Never forward host error text: it may contain identity or credentials.
		code := status.Code(err)
		if code == codes.Unknown {
			code = codes.Unavailable
		}
		return nil, status.Error(code, "host telemetry read failed")
	}
	out, err := FilterSnapshot(payload, q)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.generation != generation {
		return nil, status.Error(codes.FailedPrecondition, "telemetry configuration or host changed")
	}
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	return out, nil
}

func PrepareQuery(raw []byte, c Config, now time.Time) (public.Query, error) {
	var q public.Query
	if err := CheckObject(raw, "user_ids", "start", "end", "timezone", "cursor", "page_size"); err != nil {
		return q, err
	}
	var err error
	if q, err = public.DecodeQuery(raw); err != nil {
		return q, errors.New("invalid telemetry query")
	}
	if q.Timezone == "" {
		q.Timezone = c.Timezone
	}
	if q.PageSize == 0 {
		q.PageSize = c.PageSize
	}
	if q, err = q.Restrict(c.AllowedUserIDs); err != nil {
		return q, errors.New("query outside configured user scope")
	}
	q, _, _, err = q.Normalize(now)
	if err != nil {
		return q, errors.New("invalid telemetry query bounds")
	}
	return q, nil
}

// FilterSnapshot strips unknown fields at every DTO level. It also rejects a
// host returning another user's data, an unexpected window or unsupported schema.
func FilterSnapshot(raw []byte, q public.Query) ([]byte, error) {
	if len(raw) > MaxResponseBytes {
		return nil, status.Error(codes.ResourceExhausted, "host telemetry response exceeds 2 MiB")
	}
	var snapshot *public.Snapshot
	if len(raw) == 0 || json.Unmarshal(raw, &snapshot) != nil || snapshot == nil {
		return nil, status.Error(codes.DataLoss, "invalid host telemetry snapshot")
	}
	if snapshot.SchemaVersion != public.APIVersion || snapshot.Window != (public.Window{Start: q.Start, End: q.End, Timezone: q.Timezone}) || len(snapshot.Users) > q.PageSize {
		return nil, status.Error(codes.DataLoss, "host telemetry schema, window or page mismatch")
	}
	scope, seen := map[string]bool{}, map[string]bool{}
	for _, id := range q.UserIDs {
		scope[id] = true
	}
	for _, user := range snapshot.Users {
		if !scope[user.UserID] || seen[user.UserID] {
			return nil, status.Error(codes.PermissionDenied, "host telemetry returned users outside requested scope")
		}
		seen[user.UserID] = true
		for _, key := range user.APIKeys {
			if _, err := public.ParseID(key.ID); err != nil {
				return nil, status.Error(codes.DataLoss, "invalid host API metadata ID")
			}
		}
	}
	if snapshot.NextCursor != nil {
		if _, err := public.ParseID(*snapshot.NextCursor); err != nil || !scope[*snapshot.NextCursor] {
			return nil, status.Error(codes.DataLoss, "invalid host telemetry cursor")
		}
	}
	out, err := json.Marshal(snapshot)
	if err != nil {
		return nil, status.Error(codes.DataLoss, "cannot encode host telemetry snapshot")
	}
	if len(out) > MaxResponseBytes {
		return nil, status.Error(codes.ResourceExhausted, "telemetry response exceeds 2 MiB")
	}
	return out, nil
}
