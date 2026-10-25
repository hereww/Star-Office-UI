// Package telemetry implements the independent, read-only plugin business runtime.
package telemetry

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"time"

	public "github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
)

const MaxInputBytes = 64 * 1024

type Config struct {
	AllowedUserIDs []string `json:"allowed_user_ids"`
	Timezone       string   `json:"timezone"`
	PageSize       int      `json:"page_size,omitempty"`
}

// CheckObject rejects null, duplicate/unknown fields, and trailing JSON without
// reflecting untrusted input (which may itself contain credentials) in errors.
func CheckObject(raw []byte, fields ...string) error {
	if len(raw) == 0 || len(raw) > MaxInputBytes {
		return errors.New("invalid JSON payload size")
	}
	allowed := make(map[string]bool, len(fields))
	for _, f := range fields {
		allowed[f] = true
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	tok, err := d.Token()
	if err != nil || tok != json.Delim('{') {
		return errors.New("JSON object required")
	}
	seen := map[string]bool{}
	for d.More() {
		tok, err = d.Token()
		key, ok := tok.(string)
		if err != nil || !ok || !allowed[key] || seen[key] {
			return errors.New("unknown or duplicate JSON field")
		}
		seen[key] = true
		var value json.RawMessage
		if err := d.Decode(&value); err != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New("invalid or null JSON field")
		}
	}
	if _, err := d.Token(); err != nil {
		return errors.New("invalid JSON object")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("trailing JSON is not allowed")
	}
	return nil
}

func ParseConfig(raw []byte) (Config, []byte, error) {
	var c Config
	if err := CheckObject(raw, "allowed_user_ids", "timezone", "page_size"); err != nil {
		return c, nil, err
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, nil, errors.New("invalid configuration field type")
	}
	if c.Timezone == "" {
		c.Timezone = "Asia/Shanghai"
	}
	if _, err := time.LoadLocation(c.Timezone); err != nil {
		return c, nil, errors.New("invalid timezone")
	}
	if len(c.AllowedUserIDs) > public.MaxPageSize {
		return c, nil, errors.New("allowed_user_ids accepts at most 500 IDs")
	}
	seen := map[string]bool{}
	for _, id := range c.AllowedUserIDs {
		if _, err := public.ParseID(id); err != nil || seen[id] {
			return c, nil, errors.New("allowed_user_ids requires unique positive canonical int64 IDs")
		}
		seen[id] = true
	}
	// Empty defaults are deliberately valid but unconfigured, and cannot enable
	// telemetry. Applying them also revokes a previously configured scope.
	if c.AllowedUserIDs == nil {
		c.AllowedUserIDs = []string{}
	}
	if c.PageSize == 0 {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return c, nil, errors.New("invalid configuration object")
		}
		if _, supplied := fields["page_size"]; supplied {
			return c, nil, errors.New("page_size must be 1..500 when supplied")
		}
		c.PageSize = 100
	}
	if c.PageSize < 1 || c.PageSize > public.MaxPageSize {
		return c, nil, errors.New("page_size must be 1..500")
	}
	normalized, err := json.Marshal(c)
	return c, normalized, err
}
