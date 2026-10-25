// This command is a disposable integration test host, not a production service.
package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/Wei-Shaw/sub2api/internal/repository"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

type check struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}
type report struct {
	Date        string                  `json:"date"`
	HostBase    string                  `json:"host_base"`
	Environment string                  `json:"environment"`
	Checks      []check                 `json:"checks"`
	Passed      bool                    `json:"passed"`
	Snapshot    *usertelemetry.Snapshot `json:"snapshot,omitempty"`
}

// Stable reverse-RPC reader identity, with an isolated failure injection only.
type acceptanceReader struct {
	mu     sync.RWMutex
	reader *service.UserTelemetryService
}

func (r *acceptanceReader) set(s *service.UserTelemetryService) {
	r.mu.Lock()
	r.reader = s
	r.mu.Unlock()
}
func (r *acceptanceReader) ReadUserTelemetry(ctx context.Context, q json.RawMessage) (json.RawMessage, error) {
	r.mu.RLock()
	s := r.reader
	r.mu.RUnlock()
	return s.ReadUserTelemetry(ctx, q)
}

func main() {
	dsn := flag.String("dsn", os.Getenv("S2A_TELEMETRY_TEST_POSTGRES_DSN"), "isolated PostgreSQL DSN")
	redisAddr := flag.String("redis", os.Getenv("S2A_TELEMETRY_TEST_REDIS_ADDR"), "isolated Redis address")
	pkg := flag.String("package", "", "signed .s2plugin")
	pub := flag.String("public-key", "", "publisher raw base64 file")
	publisher := flag.String("publisher-id", "lvdong-user-telemetry-v1", "expected signed publisher ID paired with public-key")
	out := flag.String("report", "", "JSON acceptance report")
	browserScript := flag.String("browser-script", "", "optional native browser QA script")
	flag.Parse()
	if *dsn == "" || *redisAddr == "" || *pkg == "" || *pub == "" || *out == "" {
		panic("isolated test DB, Redis, package, public key and report are required")
	}
	rep := &report{Date: "2026-10-04", HostBase: "b8dece9000c68815a5b867ca5a1e6f236e173905", Environment: "isolated PostgreSQL + Redis + signed native plugin; fixture identities only", Checks: []check{}, Passed: false}
	finish := func() { raw, _ := json.MarshalIndent(rep, "", "  "); must(os.WriteFile(*out, append(raw, '\n'), 0644)) }
	defer finish()
	verify := func(name string, ok bool, detail string) {
		rep.Checks = append(rep.Checks, check{name, ok, detail})
		if !ok {
			rep.Passed = false
			finish()
			panic("acceptance failed: " + name)
		}
		fmt.Println("PASS:", name)
	}
	db, err := sql.Open("postgres", *dsn)
	must(err)
	defer db.Close()
	ctx := context.Background()
	must(db.PingContext(ctx))
	var dbname string
	must(db.QueryRowContext(ctx, `SELECT current_database()`).Scan(&dbname))
	if dbname != "telemetry_acceptance" {
		panic("will only seed database named telemetry_acceptance")
	}
	must(seed(db))
	for _, f := range []string{"229_plugins.sql", "230_plugin_artifacts.sql", "242_user_telemetry_credentials.sql", "243_user_telemetry_permanent_credentials.sql"} {
		b, e := os.ReadFile(filepath.Join("migrations", f))
		must(e)
		_, e = db.Exec(string(b))
		must(e)
	}
	rdb := redis.NewClient(&redis.Options{Addr: *redisAddr})
	defer rdb.Close()
	must(rdb.Ping(ctx).Err())
	concurrency := service.NewConcurrencyService(repository.NewConcurrencyCache(rdb, 15, 60))
	reader := service.NewUserTelemetryService(db, concurrency)
	switchReader := &acceptanceReader{reader: reader}
	var aesKey [32]byte
	_, err = rand.Read(aesKey[:])
	must(err)
	tmp, err := os.MkdirTemp("", "s2ut-integration-")
	must(err)
	defer os.RemoveAll(tmp)
	keyRaw, err := os.ReadFile(*pub)
	must(err)
	cfg := &config.Config{Totp: config.TotpConfig{EncryptionKey: hex.EncodeToString(aesKey[:])}, Plugins: config.PluginConfig{DataDir: tmp, AllowUnsigned: false, TrustedPublishers: map[string]string{*publisher: strings.TrimSpace(string(keyRaw))}, MaxUploadBytes: 128 << 20, MaxUncompressedBytes: 256 << 20, StartTimeoutSeconds: 15}}
	encryptor, err := repository.NewAESEncryptor(cfg)
	must(err)
	pluginRepo := repository.NewPluginRepository(db)
	manager := service.NewPluginManager(pluginRepo, encryptor, cfg, service.PluginHostInfo{Version: "0.2.13", BuildType: "release"}, nil)
	manager.SetUserTelemetryReader(switchReader)
	must(manager.Start(ctx))
	defer func() { manager.Stop() }()
	store := repository.NewUserTelemetryCredentialStore(db)
	h := admin.NewPluginHandler(manager, store)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// Disposable test authentication substitutes only the login flow. Production routes use AdminAuth+StepUp.
	adminSecret, _, err := service.NewUserTelemetrySecret()
	must(err)
	group := engine.Group("/api/v1/admin/plugins")
	group.Use(func(c *gin.Context) {
		if c.GetHeader("Authorization") != "Bearer "+adminSecret {
			c.AbortWithStatus(401)
			return
		}
		c.Next()
	})
	group.POST("/upload", h.Upload)
	group.POST("/:id/enable", h.Enable)
	group.POST("/:id/disable", h.Disable)
	group.DELETE("/:id", h.Delete)
	group.PUT("/:id/config", h.SaveConfig)
	group.GET("/:id/config", h.GetConfig)
	group.POST("/:id/test", h.Test)
	group.POST("/:id/ui-session", h.CreateUISession)
	engine.GET("/api/v1/plugin-ui/:token/*path", h.ServeUIAsset)
	group.GET("/:id/user-telemetry", h.ReadUserTelemetry)
	group.POST("/:id/user-telemetry/credentials", h.CreateTelemetryCredential)
	group.GET("/:id/user-telemetry/credentials", h.ListTelemetryCredentials)
	group.DELETE("/:id/user-telemetry/credentials/:credential_id", h.RevokeTelemetryCredential)
	engine.GET("/api/v1/plugins/:id/user-telemetry", h.ReadUserTelemetryExternal)
	engine.GET("/api/v1/plugins/:id/user-telemetry/status", h.ReadUserTelemetryStatusExternal)
	request := func(method, path, body, token string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		engine.ServeHTTP(w, req)
		return w
	}
	archive, err := os.ReadFile(*pkg)
	must(err)
	// Reject altered binaries using the exact native installer before real HTTP upload.
	tampered := tamper(archive)
	_, err = manager.Install(ctx, bytes.NewReader(tampered), nil)
	verify("signed-package tampering rejected", err != nil, "")
	var upload bytes.Buffer
	mp := multipart.NewWriter(&upload)
	part, err := mp.CreateFormFile("plugin", "user-telemetry.s2plugin")
	must(err)
	_, err = part.Write(archive)
	must(err)
	must(mp.Close())
	uw := httptest.NewRecorder()
	ur := httptest.NewRequest("POST", "/api/v1/admin/plugins/upload", &upload)
	ur.Header.Set("Content-Type", mp.FormDataContentType())
	ur.Header.Set("Authorization", "Bearer "+adminSecret)
	engine.ServeHTTP(uw, ur)
	verify("native plugin-management upload", uw.Code == http.StatusCreated, fmt.Sprintf("HTTP %d", uw.Code))
	var installed struct {
		Data service.PluginInstallation `json:"data"`
	}
	must(json.Unmarshal(uw.Body.Bytes(), &installed))
	id := installed.Data.ID
	verify("publisher signature verified and initially disabled", installed.Data.SignatureStatus == "trusted" && installed.Data.State == "disabled", "")
	base := "/api/v1/admin/plugins/" + strconv.FormatInt(id, 10)
	export := "/api/v1/plugins/" + strconv.FormatInt(id, 10) + "/user-telemetry"
	configJSON := `{"allowed_user_ids":["42","43","44","9007199254740993"],"timezone":"Asia/Shanghai"}`
	cw := request("PUT", base+"/config", configJSON, adminSecret)
	verify("configuration saved through native manager", cw.Code == 200, fmt.Sprintf("HTTP %d %s", cw.Code, redactError(cw)))
	ew := request("POST", base+"/enable", `{"accept_untested":true,"rollout_percent":100}`, adminSecret)
	verify("native independent read-only runtime enabled", ew.Code == 200, fmt.Sprintf("HTTP %d %s", ew.Code, redactError(ew)))
	uiSession := request("POST", base+"/ui-session", "", adminSecret)
	verify("native UI resource session issued", uiSession.Code == 200, "")
	var uiSessionData struct {
		Data struct {
			URL         string `json:"url"`
			BridgeToken string `json:"bridge_token"`
		} `json:"data"`
	}
	must(json.Unmarshal(uiSession.Body.Bytes(), &uiSessionData))
	assetPath := strings.Split(uiSessionData.Data.URL, "#")[0]
	uiAsset := request("GET", assetPath, "", "")
	verify("signed-package UI served with sandbox CSP", uiAsset.Code == 200 && strings.Contains(uiAsset.Header().Get("Content-Security-Policy"), "connect-src 'none'") && strings.Contains(uiAsset.Header().Get("Content-Security-Policy"), "form-action 'none'") && uiAsset.Header().Get("Referrer-Policy") == "no-referrer" && strings.Contains(uiAsset.Body.String(), "allowed_user_ids"), "")
	verify("UI resource token cannot export user data", request("GET", export, "", uiSessionData.Data.BridgeToken).Code == 401, "")
	if *browserScript != "" {
		must(runNativeBrowser(engine, request, base, adminSecret, uiSessionData.Data.URL, uiSessionData.Data.BridgeToken, *browserScript, filepath.Join(filepath.Dir(*out), "browser-qa")))
		verify("native sandbox browser desktop and mobile", true, "real signed UI + resource/CSP/config handlers; disposable parent login bridge")
	}
	for _, token := range []string{"", "ordinary-admin-jwt", "sk-model-api-key", "ui-resource-token"} {
		w := request("GET", export, "", token)
		verify("export denies unrelated credential "+tokenCategory(token), w.Code == 401, "")
	}
	emptyIssue := request("POST", base+"/user-telemetry/credentials", `{"name":"no-scope","user_ids":[],"expires_in_seconds":3600}`, adminSecret)
	verify("credential issue refuses ambiguous empty scope", emptyIssue.Code == 400, "")
	issue := request("POST", base+"/user-telemetry/credentials", `{"name":"integration-read-only","user_ids":["42","43","44","9007199254740993"],"expires_in_seconds":3600}`, adminSecret)
	verify("scoped export credential issued", issue.Code == 201, fmt.Sprintf("HTTP %d", issue.Code))
	var issued struct {
		Data struct {
			Token      string                          `json:"token"`
			Credential service.UserTelemetryCredential `json:"credential"`
		} `json:"data"`
	}
	must(json.Unmarshal(issue.Body.Bytes(), &issued))
	token := issued.Data.Token
	expiredToken, expiredHash, err := service.NewUserTelemetrySecret()
	must(err)
	expiredAt := time.Now().Add(-time.Minute)
	must(store.Create(ctx, &service.UserTelemetryCredential{PluginID: id, Name: "expired-fixture", UserIDs: []string{"42"}, TokenHash: expiredHash, ExpiresAt: &expiredAt}))
	verify("expired credential refused", request("GET", export, "", expiredToken).Code == 401, "")
	otherPlugin := strings.Replace(export, "/plugins/"+strconv.FormatInt(id, 10)+"/", "/plugins/"+strconv.FormatInt(id+1, 10)+"/", 1)
	verify("credential cannot cross plugin installation", request("GET", otherPlugin, "", token).Code == 401, "")
	verify("URL bearer disclosure refused", request("GET", export+"?token=forbidden", "", token).Code == 400, "")
	credentialPage := request("GET", base+"/user-telemetry/credentials?page_size=1", "", adminSecret)
	var credentialPageData struct {
		Data service.UserTelemetryCredentialPage `json:"data"`
	}
	must(json.Unmarshal(credentialPage.Body.Bytes(), &credentialPageData))
	verify("credential inventory exposes explicit cursor", credentialPage.Code == 200 && len(credentialPageData.Data.Credentials) == 1 && credentialPageData.Data.NextCursor != nil, "")
	credentialPage2 := request("GET", base+"/user-telemetry/credentials?page_size=1&cursor="+*credentialPageData.Data.NextCursor, "", adminSecret)
	must(json.Unmarshal(credentialPage2.Body.Bytes(), &credentialPageData))
	verify("credential inventory can reach oldest active credential", credentialPage2.Code == 200 && len(credentialPageData.Data.Credentials) == 1 && credentialPageData.Data.Credentials[0].ID == issued.Data.Credential.ID && credentialPageData.Data.NextCursor == nil, "")
	acquire, err := concurrency.AcquireUserSlot(ctx, 42, 5)
	must(err)
	if !acquire.Acquired {
		panic("no first slot")
	}
	second, err := concurrency.AcquireUserSlot(ctx, 42, 5)
	must(err)
	if !second.Acquired {
		panic("no second slot")
	}
	path := export + "?start=2026-10-03T00:00:00%2B08:00&end=2026-10-04T00:00:00%2B08:00&page_size=2"
	read := request("GET", path, "", token)
	verify("five-field snapshot from live PostgreSQL and Redis", read.Code == 200, fmt.Sprintf("HTTP %d %s", read.Code, redactError(read)))
	var snap usertelemetry.Snapshot
	must(json.Unmarshal(read.Body.Bytes(), &snap))
	rep.Snapshot = new(usertelemetry.Snapshot)
	must(json.Unmarshal(read.Body.Bytes(), rep.Snapshot))
	verify("only requested page and stable user IDs", len(snap.Users) == 2 && snap.Users[0].UserID == "42" && snap.NextCursor != nil, "")
	u := snap.Users[0]
	verify("real token total includes multiple and deleted historical keys", u.TokenUsage.Total != nil && *u.TokenUsage.Total == "210", "")
	verify("live concurrent user slots = 2", u.Concurrency.Current != nil && *u.Concurrency.Current == 2 && u.Concurrency.Limit == 5, "")
	verify("API metadata is complete without deleted key", len(u.APIKeys) == 2 && u.APIKeys[0].ID == "101", "")
	verify("email and blank username retained", snap.Users[1].Username == "" && u.Email == "fixture42@example.com", "")
	verify("no model or admin secrets in export", !strings.Contains(read.Body.String(), "do-not-export") && !strings.Contains(read.Body.String(), token) && !strings.Contains(read.Body.String(), adminSecret) && !strings.Contains(read.Body.String(), `"key"`), "")
	next := request("GET", path+"&cursor="+*snap.NextCursor, "", token)
	var page2 usertelemetry.Snapshot
	must(json.Unmarshal(next.Body.Bytes(), &page2))
	verify("pagination and >2^53 ID preservation", next.Code == 200 && len(page2.Users) == 2 && page2.Users[1].UserID == "9007199254740993", "")
	verify("unlimited concurrency not fabricated as zero", page2.Users[0].Concurrency.Current == nil && page2.Users[0].Quality.Concurrency == "untracked", "")
	second.ReleaseFunc()
	one := request("GET", path, "", token)
	must(json.Unmarshal(one.Body.Bytes(), &snap))
	verify("slot release changes count to one", snap.Users[0].Concurrency.Current != nil && *snap.Users[0].Concurrency.Current == 1, "")
	acquire.ReleaseFunc()
	zero := request("GET", path, "", token)
	must(json.Unmarshal(zero.Body.Bytes(), &snap))
	verify("confirmed no slots returns real zero", snap.Users[0].Concurrency.Current != nil && *snap.Users[0].Concurrency.Current == 0, "")
	denied := request("GET", path+"&user_ids=999", "", token)
	verify("user-scope escape rejected", denied.Code == 403, "")
	bad := request("GET", strings.Replace(path, "page_size=2", "page_size=1000", 1), "", token)
	verify("oversized query rejected", bad.Code == 400, "")
	list := request("GET", base+"/user-telemetry/credentials", "", adminSecret)
	verify("credential list has no token or hash", list.Code == 200 && !strings.Contains(list.Body.String(), token) && !strings.Contains(list.Body.String(), "token_hash"), "")
	narrow := request("PUT", base+"/config", `{"allowed_user_ids":["42"],"timezone":"Asia/Shanghai"}`, adminSecret)
	narrowed := request("GET", path+"&user_ids=43", "", token)
	verify("scope narrowing revokes old credential user permission immediately", narrow.Code == 200 && narrowed.Code == 403, "")
	restore := request("PUT", base+"/config", configJSON, adminSecret)
	verify("approved scope restores through native configuration lifecycle", restore.Code == 200, "")
	defaultsSaved := request("PUT", base+"/config", `{"allowed_user_ids":["42","43","44","9007199254740993"],"timezone":"UTC","page_size":1}`, adminSecret)
	defaultsRead := request("GET", export, "", token)
	var defaultsSnapshot usertelemetry.Snapshot
	must(json.Unmarshal(defaultsRead.Body.Bytes(), &defaultsSnapshot))
	verify("HTTP omitted defaults follow saved timezone and page size", defaultsSaved.Code == 200 && defaultsRead.Code == 200 && len(defaultsSnapshot.Users) == 1 && defaultsSnapshot.Window.Timezone == "UTC", "")
	restore = request("PUT", base+"/config", configJSON, adminSecret)
	verify("fixture defaults restored", restore.Code == 200, "")
	// A real backend failure is not a successful zero reading.
	brokenRDB := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond, ReadTimeout: 100 * time.Millisecond})
	defer brokenRDB.Close()
	brokenReader := service.NewUserTelemetryService(db, service.NewConcurrencyService(repository.NewConcurrencyCache(brokenRDB, 15, 60)))
	switchReader.set(brokenReader)
	unavailable := request("GET", path, "", token)
	must(json.Unmarshal(unavailable.Body.Bytes(), &snap))
	verify("Redis failure produces unknown concurrency", unavailable.Code == 200 && snap.Users[0].Concurrency.Current == nil && snap.Users[0].Quality.Concurrency == "unavailable", "")
	switchReader.set(reader)
	manager.Stop()
	manager = service.NewPluginManager(pluginRepo, encryptor, cfg, service.PluginHostInfo{Version: "0.2.13", BuildType: "release"}, nil)
	manager.SetUserTelemetryReader(switchReader)
	must(manager.Start(ctx))
	h = admin.NewPluginHandler(manager, store)
	// Rebind a fresh router after restarting the actual managed process.
	engine = gin.New()
	engine.GET("/api/v1/plugins/:id/user-telemetry", h.ReadUserTelemetryExternal)
	engine.GET("/api/v1/plugins/:id/user-telemetry/status", h.ReadUserTelemetryStatusExternal)
	// Restore the management route with the same disposable login boundary.
	group = engine.Group("/api/v1/admin/plugins")
	group.Use(func(c *gin.Context) {
		if c.GetHeader("Authorization") != "Bearer "+adminSecret {
			c.AbortWithStatus(401)
			return
		}
		c.Next()
	})
	group.DELETE("/:id/user-telemetry/credentials/:credential_id", h.RevokeTelemetryCredential)
	// All Gin routes must be registered before any request warms its params pool.
	restarted := request("GET", path, "", token)
	verify("persisted installation and scope recover after host restart", restarted.Code == 200, fmt.Sprintf("HTTP %d", restarted.Code))
	revokedThroughHTTP := request("DELETE", base+"/user-telemetry/credentials/"+strconv.FormatInt(issued.Data.Credential.ID, 10), "", adminSecret)
	verify("native management route revokes credential", revokedThroughHTTP.Code == 200, "")
	revoked := request("GET", path, "", token)
	verify("credential revocation takes immediate effect", revoked.Code == 401, "")
	token2, hash2, err := service.NewUserTelemetrySecret()
	must(err)
	expiresAt := time.Now().Add(time.Hour)
	must(store.Create(ctx, &service.UserTelemetryCredential{PluginID: id, Name: "post-restart", UserIDs: []string{"42"}, TokenHash: hash2, ExpiresAt: &expiresAt}))
	beforeDisable := request("GET", path+"&user_ids=42", "", token2)
	verify("new scoped credential usable after restart", beforeDisable.Code == 200, "")
	_, err = manager.Disable(ctx, id)
	must(err)
	disabled := request("GET", path+"&user_ids=42", "", token2)
	verify("disable closes output endpoint", disabled.Code == 503, "")
	err = manager.Delete(ctx, id)
	must(err)
	var credentialCount, userCount, usageCount int
	must(db.QueryRow(`SELECT COUNT(*) FROM sub2api_user_telemetry_credentials WHERE plugin_id=$1`, id).Scan(&credentialCount))
	must(db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount))
	must(db.QueryRow(`SELECT COUNT(*) FROM usage_logs`).Scan(&usageCount))
	verify("uninstall revokes credentials without deleting business data", credentialCount == 0 && userCount == 4 && usageCount == 5, "")
	rep.Passed = true
	fmt.Printf("Acceptance passed: %d checks; no production services touched.\n", len(rep.Checks))
}
func seed(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,email TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',concurrency INT NOT NULL,status TEXT NOT NULL DEFAULT 'active',deleted_at TIMESTAMPTZ);CREATE TABLE api_keys(id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),key TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,deleted_at TIMESTAMPTZ);CREATE TABLE usage_logs(id BIGSERIAL PRIMARY KEY,user_id BIGINT,api_key_id BIGINT,input_tokens INT NOT NULL DEFAULT 0,output_tokens INT NOT NULL DEFAULT 0,cache_creation_tokens INT NOT NULL DEFAULT 0,cache_read_tokens INT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL);
 INSERT INTO users VALUES(42,'fixture42@example.com','研发助手',5,'active',NULL),(43,'fixture43@example.com','',5,'active',NULL),(44,'fixture44@example.com','不限并发',0,'active',NULL),(9007199254740993,'fixture-large@example.com','大ID',5,'active',NULL);
 INSERT INTO api_keys VALUES(101,42,'do-not-export-key-1','工作A','active',NULL),(102,42,'do-not-export-key-2','工作B','disabled',NULL),(103,42,'do-not-export-deleted','历史','active',NOW()),(104,43,'do-not-export-other','其他用户','active',NULL);
 INSERT INTO usage_logs(user_id,api_key_id,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,created_at) VALUES(42,101,100,50,20,30,'2026-10-03T08:00:00+08:00'),(42,103,5,5,0,0,'2026-10-03T08:10:00+08:00'),(43,104,900,100,0,0,'2026-10-03T08:20:00+08:00'),(42,101,999,999,0,0,'2026-10-02T23:59:59+08:00'),(42,101,999,999,0,0,'2026-10-04T00:00:00+08:00');`)
	return err
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
func tokenCategory(s string) string {
	if s == "" {
		return "absent"
	}
	if strings.HasPrefix(s, "sk-") {
		return "model key"
	}
	if strings.HasPrefix(s, "ui-") {
		return "UI token"
	}
	return "admin token"
}
func redactError(w *httptest.ResponseRecorder) string {
	if w.Code < 400 {
		return ""
	}
	var e struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &e)
	return e.Message
}
func tamper(raw []byte) []byte {
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	must(err)
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	changed := false
	for _, f := range zr.File {
		r, e := f.Open()
		must(e)
		b, e := io.ReadAll(r)
		must(e)
		r.Close()
		if !changed && strings.HasPrefix(f.Name, "runtimes/") && len(b) > 0 {
			b[0] ^= 1
			changed = true
		}
		w, e := zw.Create(f.Name)
		must(e)
		_, e = w.Write(b)
		must(e)
	}
	must(zw.Close())
	if !changed {
		panic("no runtime to tamper")
	}
	return out.Bytes()
}
