// Package usertelemetry defines the versioned, secret-free telemetry contract.
package usertelemetry

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const Capability = "sub2api.user_telemetry.read.v1"
const APIVersion = 1
const MaxPageSize = 500
const MaxWindow = 31 * 24 * time.Hour

// Query is transported over the private plugin RPC; strings preserve int64 IDs.
type Query struct {
	UserIDs  []string `json:"user_ids"`
	Start    string   `json:"start,omitempty"`
	End      string   `json:"end,omitempty"`
	Timezone string   `json:"timezone,omitempty"`
	Cursor   string   `json:"cursor,omitempty"`
	PageSize int      `json:"page_size,omitempty"`
}
type Window struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	Timezone string `json:"timezone"`
}
type APIKey struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}
type TokenUsage struct {
	Total *string `json:"total"`
}
type Concurrency struct {
	Current *int `json:"current"`
	Limit   int  `json:"limit"`
}
type Quality struct {
	Identity    string `json:"identity"`
	APIKeys     string `json:"api_keys"`
	TokenUsage  string `json:"token_usage"`
	Concurrency string `json:"concurrency"`
}
type ObservedAt struct {
	Identity    string  `json:"identity"`
	APIKeys     *string `json:"api_keys"`
	TokenUsage  *string `json:"token_usage"`
	Concurrency *string `json:"concurrency"`
}
type User struct {
	UserID      string      `json:"user_id"`
	Email       string      `json:"email"`
	Username    string      `json:"username"`
	APIKeys     []APIKey    `json:"api_keys"`
	TokenUsage  TokenUsage  `json:"token_usage"`
	Concurrency Concurrency `json:"concurrency"`
	Quality     Quality     `json:"quality"`
	ObservedAt  ObservedAt  `json:"observed_at"`
}
type Snapshot struct {
	SchemaVersion int     `json:"schema_version"`
	Window        Window  `json:"window"`
	Users         []User  `json:"users"`
	NextCursor    *string `json:"next_cursor"`
}

func DecodeQuery(raw []byte) (Query, error) {
	var q Query
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&q); err != nil {
		return q, fmt.Errorf("invalid telemetry query: %w", err)
	}
	var extra interface{}
	if err := d.Decode(&extra); err != nil && err != io.EOF {
		return q, fmt.Errorf("invalid trailing query: %w", err)
	} else if err == nil {
		return q, fmt.Errorf("multiple query values")
	}
	return q, nil
}
func ParseID(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != s {
		return 0, fmt.Errorf("invalid positive canonical ID")
	}
	return id, nil
}

// Normalize validates bounded inputs and freezes a single explicit time window.
func (q Query) Normalize(now time.Time) (Query, time.Time, time.Time, error) {
	if q.Timezone == "" {
		q.Timezone = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(q.Timezone)
	if err != nil {
		return q, time.Time{}, time.Time{}, fmt.Errorf("invalid timezone")
	}
	if q.PageSize == 0 {
		q.PageSize = 100
	}
	if q.PageSize < 1 || q.PageSize > MaxPageSize {
		return q, time.Time{}, time.Time{}, fmt.Errorf("page_size must be 1..500")
	}
	if len(q.UserIDs) == 0 || len(q.UserIDs) > MaxPageSize {
		return q, time.Time{}, time.Time{}, fmt.Errorf("user_ids must contain 1..500 IDs")
	}
	seen := map[int64]bool{}
	for _, s := range q.UserIDs {
		id, e := ParseID(s)
		if e != nil || seen[id] {
			return q, time.Time{}, time.Time{}, fmt.Errorf("invalid or duplicate user_id")
		}
		seen[id] = true
	}
	if q.Cursor != "" {
		if _, e := ParseID(q.Cursor); e != nil {
			return q, time.Time{}, time.Time{}, fmt.Errorf("invalid cursor")
		}
	}
	var start, end time.Time
	if q.Start == "" && q.End == "" {
		end = now.In(loc)
		start = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
	} else {
		if q.Start == "" || q.End == "" {
			return q, start, end, fmt.Errorf("start and end must be supplied together")
		}
		start, err = time.Parse(time.RFC3339Nano, q.Start)
		if err != nil {
			return q, start, end, fmt.Errorf("invalid start")
		}
		end, err = time.Parse(time.RFC3339Nano, q.End)
		if err != nil {
			return q, start, end, fmt.Errorf("invalid end")
		}
	}
	if !end.After(start) || end.Sub(start) > MaxWindow || end.After(now.Add(time.Minute)) {
		return q, start, end, fmt.Errorf("window must be past [start,end), at most 31 days")
	}
	q.Start = start.In(loc).Format(time.RFC3339Nano)
	q.End = end.In(loc).Format(time.RFC3339Nano)
	return q, start, end, nil
}

// Intersect enforces caller scope. An explicitly requested unauthorized ID fails closed.
func (q Query) Restrict(allowed []string) (Query, error) {
	set := map[string]bool{}
	for _, id := range allowed {
		if _, err := ParseID(id); err != nil {
			return q, err
		}
		set[id] = true
	}
	if len(set) == 0 {
		return q, fmt.Errorf("no authorized users")
	}
	if len(q.UserIDs) == 0 {
		q.UserIDs = append([]string(nil), allowed...)
	}
	for _, id := range q.UserIDs {
		if !set[id] {
			return q, fmt.Errorf("user outside authorized scope")
		}
	}
	return q, nil
}
