package usertelemetry

import (
	"testing"
	"time"
)

func TestQueryValidation(t *testing.T) {
	now := time.Date(2026, 10, 4, 8, 0, 0, 0, time.UTC)
	q := Query{UserIDs: []string{"9223372036854775807"}}
	n, s, e, err := q.Normalize(now)
	if err != nil || n.Timezone != "Asia/Shanghai" || s.Hour() != 0 || !e.Equal(now) {
		t.Fatalf("%+v %v", n, err)
	}
	q.UserIDs = []string{"01"}
	if _, _, _, err = q.Normalize(now); err == nil {
		t.Fatal("noncanonical id accepted")
	}
	if _, err = DecodeQuery([]byte(`{"user_ids":["1"],"sql":"secret"}`)); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err = DecodeQuery([]byte(`{} {}`)); err == nil {
		t.Fatal("trailing JSON accepted")
	}
}
func TestRestrict(t *testing.T) {
	q := Query{UserIDs: []string{"2"}}
	if _, e := q.Restrict([]string{"1"}); e == nil {
		t.Fatal("scope escape")
	}
	q.UserIDs = nil
	n, e := q.Restrict([]string{"1"})
	if e != nil || len(n.UserIDs) != 1 {
		t.Fatal(e)
	}
}
