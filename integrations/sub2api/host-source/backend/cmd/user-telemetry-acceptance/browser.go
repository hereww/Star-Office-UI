package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"

	"github.com/gin-gonic/gin"
)

// Native asset/API handlers are exercised; only the parent login/bridge is a
// disposable test shim, not a production route or the complete Vue admin UI.
func runNativeBrowser(engine *gin.Engine, request func(string, string, string, string) *httptest.ResponseRecorder, base, adminToken, uiURL, bridgeToken, script, outDir string) error {
	urlJS, _ := json.Marshal(uiURL)
	tokenJS, _ := json.Marshal(bridgeToken)
	engine.GET("/acceptance-ui", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Data(200, "text/html; charset=utf-8", []byte(fmt.Sprintf(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native telemetry acceptance</title><style>html,body{margin:0}iframe{display:block;width:100%%;border:0;min-height:680px}</style><iframe id="plugin" sandbox="allow-scripts"></iframe><script>
 const frame=document.getElementById('plugin'),token=%s;frame.src=%s;window.acceptanceCalls=[];
 window.addEventListener('message',async event=>{
 const m=event.data;if(event.source!==frame.contentWindow||event.origin!=='null'||!m||m.source!=='sub2api-plugin-ui'||m.bridge_token!==token)return;
 window.acceptanceCalls.push(m.type);
 if(m.type==='ui.resize'){frame.style.height=m.height+'px';return;}
 if(!['config.load','config.save','config.test'].includes(m.type))return;
 try{const result=await fetch('/acceptance-ui/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Acceptance-Bridge':token},body:JSON.stringify({type:m.type,config:m.config})}).then(r=>r.json());frame.contentWindow.postMessage({source:'sub2api-plugin-host',bridge_token:token,request_id:m.request_id,type:m.type+'.result',...result},'*');}catch{frame.contentWindow.postMessage({source:'sub2api-plugin-host',bridge_token:token,request_id:m.request_id,type:m.type+'.result',ok:false},'*');}
 });</script>`, tokenJS, urlJS)))
	})
	engine.POST("/acceptance-ui/bridge", func(c *gin.Context) {
		if c.GetHeader("X-Acceptance-Bridge") != bridgeToken {
			c.AbortWithStatus(401)
			return
		}
		var m struct {
			Type   string          `json:"type"`
			Config json.RawMessage `json:"config"`
		}
		if c.ShouldBindJSON(&m) != nil {
			c.AbortWithStatus(400)
			return
		}
		method, path, body := "GET", base+"/config", ""
		switch m.Type {
		case "config.load":
		case "config.save":
			method, body = "PUT", string(m.Config)
		case "config.test":
			method, path = "POST", base+"/test"
		default:
			c.AbortWithStatus(400)
			return
		}
		w := request(method, path, body, adminToken)
		if w.Code >= 400 {
			c.JSON(200, gin.H{"ok": false})
			return
		}
		if m.Type == "config.test" {
			var value struct {
				Data json.RawMessage `json:"data"`
			}
			if json.Unmarshal(w.Body.Bytes(), &value) != nil {
				c.JSON(200, gin.H{"ok": false})
				return
			}
			c.JSON(200, gin.H{"ok": true, "result": value.Data})
			return
		}
		c.JSON(200, gin.H{"ok": true, "config": json.RawMessage(w.Body.Bytes())})
	})
	server := httptest.NewServer(engine)
	defer server.Close()
	cmd := exec.Command("node", script, server.URL+"/acceptance-ui", outDir)
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("native browser acceptance failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	fmt.Print(string(output))
	return nil
}
