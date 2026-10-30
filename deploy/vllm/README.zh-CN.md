# vLLM 自动部署脚本

`vllm-deploy.sh` 用 Docker 启动 OpenAI 兼容的 vLLM 服务，并把 API Key、端口和 GPU 参数集中成可重复执行的配置。

脚本默认使用 Docker `host` 网络，让 vLLM 进程直接监听宿主机地址。这个模式适合当前服务器的 `0.0.0.0:18000` 直连和 FRP/反代场景，也绕开了 Docker 端口代理在内网访问时可能出现的空响应问题。

脚本会完成这些工作：

- API Key 优先从 `--api-key-file` 或 `VLLM_API_KEY` 读取；没有提供时自动生成一个新的 `sk-...` key。
- Key 保存到状态目录下的 `secrets/api-key`，权限为 `0600`，通过只读挂载交给容器，不写入 Docker 环境变量。
- 模型缓存、vLLM/Torch 编译缓存和配置文件独立保存在状态目录，重启时复用。
- `/health`、`/v1/models` 和“无 Key 应返回 401”都会自动验证。
- 替换已有容器前先停止并重命名旧容器，保存 inspect、日志和恢复信息；新容器未通过健康检查时自动尝试回滚。

## 在服务器上首次部署

先把脚本上传到服务器，然后在服务器上执行。推荐使用密钥文件，避免 API Key 进入 shell 历史：

```bash
chmod +x ./vllm-deploy.sh
umask 077
printf '%s\n' '替换成你的自定义key' > /root/vllm-api-key

./vllm-deploy.sh \
  --model Qwen/Qwen3.6-35B-A3B-FP8 \
  --port 18000 \
  --api-key-file /root/vllm-api-key \
  --tensor-parallel-size 2 \
  --max-model-len 32768 \
  --replace
```

如果部署的是目前服务器上的 Qwen3.8 模型，把 `--model` 改成实际缓存的模型名，例如：

```bash
--model Qwen/Qwen3.8-27B-FP8 --tensor-parallel-size 4 --max-model-len 262144
```

如果要替换已经运行的服务，先在服务器上读取真实容器名和缓存目录，再把它们传给脚本，避免因为名字不同而启动第二个服务：

```bash
docker ps --format '{{.Names}}'
docker inspect <现有容器名> --format '{{json .Mounts}}'
```

然后补上 `--container-name <现有容器名>` 和实际的 `--model-cache`、`--compile-cache`。

`tensor-parallel-size` 必须和 GPU 数量及模型注意力头数兼容。不要盲目把 3 张卡写成 TP=3；Qwen3.6-35B-A3B-FP8 的部署记录使用的是 TP=2。

## 自定义端口和 Key

直接传 Key 可以这样做，但 Key 会出现在当前 shell 的命令历史中：

```bash
./vllm-deploy.sh --port 19000 --api-key '你的自定义key' --replace
```

更安全的方式是：

```bash
./vllm-deploy.sh --port 19000 --api-key-file /root/vllm-api-key --replace
```

同一个状态目录再次运行时，若没有提供新 Key，脚本会复用原来的 `secrets/api-key`。要自动轮换 Key，使用 `--rotate-key`，或提供新的 `--api-key-file`。

## Hugging Face 镜像和缓存

脚本默认使用 `https://hf-mirror.com`，符合这台服务器之前的下载环境。切换回官方端点：

```bash
./vllm-deploy.sh --hf-endpoint https://huggingface.co --replace
```

如需复用已有缓存，可以显式指定：

```bash
./vllm-deploy.sh \
  --model-cache /www/wwwroot/vllm/huggingface \
  --compile-cache /www/wwwroot/vllm/vllm_cache \
  --replace
```

## 预览和验证

先只检查参数，不会拉镜像、停容器或写文件：

```bash
./vllm-deploy.sh --dry-run --port 18000 --model Qwen/Qwen3.6-35B-A3B-FP8
```

部署完成后：

```bash
KEY_FILE=/opt/vllm/secrets/api-key
curl -i http://127.0.0.1:18000/v1/models
curl -sS http://127.0.0.1:18000/v1/models \
  -H "Authorization: Bearer $(cat "$KEY_FILE")"
```

浏览器直接打开 `/v1/models` 不带 Header 得到 `401 Unauthorized` 是正常的，说明端口可达且鉴权生效。

## 当前服务器的使用建议

你刚才给出的 `http://homefrp.wanai8.com:18000/v1` 从外部已经能收到 `401 Unauthorized`，说明端口和鉴权链路可达。要改变当前部署，先确认服务器上的 SSH 登录方式可用，再执行上面的脚本；脚本不会把旧 Key 写入仓库，也不会自动修改 Nginx 或 FRP 配置。

脚本默认保守使用 `--max-model-len 32768`、`--max-num-seqs 1`、`--max-num-batched-tokens 1024` 和 `--enforce-eager`，这是为了降低长上下文和 CUDA Graph 带来的显存峰值。确认显存余量后，再按实际模型和 GPU 调大上下文长度。

## 文件位置

默认 root 状态目录为 `/opt/vllm`：

```text
/opt/vllm/<container>.env
/opt/vllm/secrets/api-key
/opt/vllm/huggingface/
/opt/vllm/compile-cache/
/opt/vllm/backups/<UTC时间>-<PID>/
```

脚本只新增/替换同名 vLLM 容器；旧容器会先重命名成 `vllm-qwen.previous-...`，确认新服务稳定后再手动删除旧容器以释放磁盘。
