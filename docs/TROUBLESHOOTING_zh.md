## 🚀 安装和连接问题

### 点击扩展的连接按钮后如果没连接成功

1. **检查mcp-chrome-bridge是否安装成功**，确保是全局安装的

```bash
mcp-chrome-bridge -v
```
<img width="612" alt="截屏2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

2. **检查清单文件是否已放在正确目录**

windows路径：C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

mac路径： /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

如果npm包安装正常的话，这个目录下会生成一个`com.chromemcp.nativehost.json`

3. **检查npm包的安装目录下是否有日志**

具体要看你的安装路径（如果不清楚，可以打开第2步的清单文件，里面的path就是安装目录），比如安装路径如下：看下日志的内容
C:\Users\admin\AppData\Local\nvm\v20.19.2\node_modules\mcp-chrome-bridge\dist\logs
<img width="804" alt="截屏2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

4. **检查是否有执行权限**

具体要看你的安装路径（如果不清楚，可以打开第2步的清单文件，里面的path就是安装目录），比如mac的安装路径如下：

`xxx/node_modules/mcp-chrome-bridge/dist/run_host.sh`
查看此脚本是否有执行权限
