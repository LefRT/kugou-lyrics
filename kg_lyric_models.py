"""Local embeddings and budgeted DeepSeek requests for lyric search."""

import json
from dataclasses import dataclass
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class ModelError(RuntimeError):
    """A model call failed. Messages exclude request bodies and credentials."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _request(url, service, *, data=None, token=None, timeout, local=False):
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    opener = build_opener(_NoRedirect(), *([ProxyHandler({})] if local else []))
    try:
        with opener.open(Request(url, data=body, headers=headers), timeout=timeout) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
    except HTTPError as error:
        raise ModelError(f"{service} HTTP {error.code}") from None
    except (URLError, OSError, HTTPException):
        raise ModelError(f"{service} 连接失败或超时") from None
    try:
        value = json.loads(raw) if len(raw) <= 16 * 1024 * 1024 else None
    except (UnicodeError, ValueError):
        value = None
    if not isinstance(value, dict):
        raise ModelError(f"{service} 返回了无效 JSON")
    return value


class OllamaEmbeddings:
    def __init__(self, model="qwen3-embedding:0.6b", url="http://127.0.0.1:11434"):
        address = urlsplit(url)
        if (address.scheme != "http" or address.hostname not in ("localhost", "127.0.0.1", "::1")
                or address.path not in ("", "/") or address.username or address.password
                or address.query or address.fragment):
            raise ValueError("Ollama 地址须为本机 HTTP 服务")
        self.model = model if ":" in model else f"{model}:latest"
        self.url = url.rstrip("/")

    def fingerprint(self):
        data = _request(f"{self.url}/api/tags", "Ollama", timeout=6, local=True)
        for item in data.get("models", []):
            if item.get("name") == self.model and item.get("digest") and not item.get("remote_host"):
                return f"{self.model}@{item['digest']}"
        raise ModelError(f"Ollama 未找到本地模型 {self.model}")

    def encode(self, texts, *, query=False):
        if query and self.model.startswith("qwen3-embedding:"):
            task = "根据听歌请求检索匹配歌词的处境、情感态度或听歌目的"
            texts = [f"Instruct: {task}\nQuery: {text}" for text in texts]
        data = _request(f"{self.url}/api/embed", "Ollama", timeout=120, local=True,
                        data={"model": self.model, "input": texts, "truncate": False})
        vectors = data.get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise ModelError("Ollama 返回的向量数量不匹配")
        return vectors


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    reported_calls: int = 0


class DeepSeek:
    def __init__(self, api_key, model="deepseek-flash"):
        self._api_key = api_key
        self.model = model
        self.usage = Usage()

    def complete(self, instruction, payload, *, max_tokens):
        if not self._api_key:
            raise ModelError("未设置 DEEPSEEK_API_KEY")
        if not self._api_key.isascii() or not self._api_key.isprintable() or " " in self._api_key:
            raise ModelError("DEEPSEEK_API_KEY 格式无效")
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if len(content) > 15_000:
            raise ModelError("DeepSeek 请求超过证据包字符上限")
        self.usage.calls += 1
        data = _request("https://api.deepseek.com/chat/completions", "DeepSeek",
                        token=self._api_key, timeout=35, data={
                            "model": self.model,
                            "messages": [
                                {"role": "system", "content": instruction},
                                {"role": "user", "content": content},
                            ],
                            "thinking": {"type": "disabled"},
                            "response_format": {"type": "json_object"},
                            "max_tokens": max_tokens,
                            "temperature": 0,
                            "stream": False,
                        })
        usage = data.get("usage")
        if isinstance(usage, dict):
            counts = usage.get("prompt_tokens"), usage.get("completion_tokens")
            if all(type(value) is int and value >= 0 for value in counts):
                self.usage.input_tokens += counts[0]
                self.usage.output_tokens += counts[1]
                self.usage.reported_calls += 1
        try:
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError
            result = json.loads(choice["message"]["content"])
        except (AttributeError, KeyError, IndexError, TypeError, ValueError):
            raise ModelError("DeepSeek 返回空白、截断或格式无效的结果") from None
        if not isinstance(result, dict):
            raise ModelError("DeepSeek 结果须为 JSON 对象")
        return result
