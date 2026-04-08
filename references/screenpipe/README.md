# Screenpipe — 参考指南

## 官方资源
- GitHub: https://github.com/mediar-ai/screenpipe
- 官网: https://screenpi.pe/
- 许可证: MIT

## 安装
```bash
npx screenpipe@latest record  # 启动后在 localhost:3030 提供 REST API
```

## 核心 API（localhost:3030）

### 健康检查
```
GET /health
```

### 搜索屏幕内容
```
GET /search?q=keyword&content_type=ocr&limit=10&app_name=Terminal
```
content_type: ocr | audio | input | accessibility | memory

### 搜索 UI 元素（按钮、输入框等）
```
GET /elements?q=Allow&role=button&app_name=System
```

### 活动概览
```
GET /activity-summary?start_time=...&end_time=...
```

## 返回格式
```json
{
  "data": [{
    "type": "ocr",
    "content": {
      "text": "识别到的文本",
      "timestamp": "2026-04-08T00:00:00Z",
      "app_name": "Terminal",
      "window_name": "zsh",
      "frame_id": 12345
    }
  }],
  "pagination": { "limit": 10, "offset": 0, "total": 100 }
}
```

## 在 Ottie 中的用法
通过 packages/screen/ 封装，轮询 API 检测屏幕变化，匹配 pattern，产出 OttieScreenEvent。
不复制源码，通过 HTTP 调用。Screenpipe 是可选依赖。
