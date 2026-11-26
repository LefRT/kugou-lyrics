# -*- coding: utf-8 -*-
"""
酷狗 API 客户端（无第三方依赖，仅标准库）。

接口与签名实现参考：
- 歌词链路：chthollyphile/folia-major src/services/onlineMusic/kugou/（实测可用）
- 登录 / 用户歌单：MakcRe/KuGouMusicApi（module/login_qr_*.js, user_playlist.js,
  playlist_track_all.js, playlist_track_all_new.js, util/helper.js, util/request.js）

三种签名（均为 md5(盐 + 排序后 key=value 串 + [请求体] + 盐)）：
- web 盐    NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt  → login-user.kugou.com（扫码登录）
- android 盐 OIlwieks28dk2k092lksi2UIkp      → gateway.kugou.com（歌单，appid 1005）
- lite 盐    LnT6xpN3khm36zse0QzvmgTZ3waWdRSA → 歌词/搜索（appid 3116，实测可用）
"""
import base64
import gzip
import hashlib
import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache

import kg_krc


@lru_cache(maxsize=512)
def song_climax(file_hash):
    """酷狗标注的同版本高潮区间，时间单位为毫秒。"""
    endpoint = "https://expendablekmrcdn.kugou.com/v1/audio_climax/audio"
    query = urllib.parse.urlencode({"data": json.dumps([{"hash": file_hash}])})
    request = urllib.request.Request(f"{endpoint}?{query}", headers={"User-Agent": UA_ANDROID})
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.load(response)
    if result.get("status") != 1:
        raise KgApiError("暂时无法读取酷狗高潮标记")
    for item in result.get("data") or []:
        if item.get("hash", "").lower() != file_hash:
            continue
        try:
            start, end = int(item["start_time"]), int(item["end_time"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= start < end:
            return {"start_ms": start, "end_ms": end}
    return None

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
SESSION_FILE = os.path.join(DATA_DIR, "session.json")

WEB_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt"
ANDROID_SALT = "OIlwieks28dk2k092lksi2UIkp"
LITE_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA"

APPID = 1005            # 安卓标准版
CLIENTVER = 20489
LITE_APPID = 3116       # 概念版（歌词/搜索实测用）
LITE_CLIENTVER = 11070
SRCAPPID = 2919

UA_LITE = "Android14-1070-11070-201-0-{module}-wifi"          # 歌词/搜索（实测）
UA_ANDROID = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi"  # 登录/网关

DEBUG_DIR = os.path.join(BASE, "debug")
DEBUG = bool(os.environ.get("KG_DEBUG"))
_RELOGIN = "酷狗登录凭据已被拒绝，请运行 py -3 kg_cli.py login 重新扫码。"


class KgApiError(Exception):
    def __init__(self, message, *, code=""):
        super().__init__(message)
        self.code = code


class KgLoginRequired(KgApiError):
    pass


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _sign(params: dict, salt: str, data: str = "") -> str:
    qs = "".join(f"{k}={params[k]}" for k in sorted(params))
    return _md5(salt + qs + (data or "") + salt)


def _error_code(data):
    return str(data.get("error_code") or data.get("errcode") or "")


# 连接失败的 CDN 节点短期内不再首选：同一网络下坏节点通常持续坏，
# 不记住的话每首没缓存的歌都要白等一次超时才换节点。
_HOST_PENALTY = {}


def note_unreachable(url):
    host = urllib.parse.urlsplit(url).hostname or ""
    if host:
        _HOST_PENALTY[host] = time.monotonic() + 300


def _dump(tag: str, obj):
    if not DEBUG:
        return
    os.makedirs(DEBUG_DIR, exist_ok=True)
    path = os.path.join(DEBUG_DIR, f"{int(time.time())}_{tag}.json")
    with open(path, "w", encoding="utf-8") as f:
        try:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        except TypeError:
            f.write(str(obj))


def _response_chunks(response, deadline, check_cancel):
    while True:
        check_cancel()
        if time.monotonic() >= deadline:
            raise TimeoutError("读取酷狗响应超时")
        chunk = response.read1(65536)
        if not chunk:
            break
        yield chunk


class KugouClient:
    def __init__(self, *, check_cancel=None):
        self.mid = _md5(str(int(time.time() * 1000)))
        self.dfid = "-"
        self.token = ""
        self.userid = ""
        self._check_cancel = check_cancel
        self.load_session()

    # ---------------- 会话 ----------------
    def load_session(self):
        if os.path.exists(SESSION_FILE):
            try:
                with open(SESSION_FILE, encoding="utf-8") as f:
                    s = json.load(f)
                if not isinstance(s, dict):
                    return
                self.mid = s.get("mid") or self.mid
                self.dfid = s.get("dfid") or "-"
                self.token = s.get("token") or ""
                self.userid = str(s.get("userid") or "")
            except (OSError, ValueError):
                pass

    def save_session(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=DATA_DIR,
                                          prefix=".session-", delete=False)
        try:
            with tmp:
                json.dump({"mid": self.mid, "dfid": self.dfid,
                           "token": self.token, "userid": self.userid}, tmp, indent=2)
            try:
                os.chmod(tmp.name, 0o600)
            except OSError:
                pass
            os.replace(tmp.name, SESSION_FILE)
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    @property
    def logged_in(self) -> bool:
        return bool(self.token and self.userid and self.userid != "0")

    # ---------------- HTTP ----------------
    def _http(self, url, headers=None, data=None, retries=2, timeout=20):
        body = data.encode("utf-8") if isinstance(data, str) else data
        last_err = None
        check_cancel = self._check_cancel
        if check_cancel:
            retries, timeout = 0, min(timeout, 6)
        for attempt in range(retries + 1):
            try:
                if check_cancel:
                    check_cancel()
                req = urllib.request.Request(url, data=body, headers=headers or {})
                deadline = time.monotonic() + timeout
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    raw = (b"".join(_response_chunks(r, deadline, check_cancel))
                           if check_cancel else r.read())
                    if r.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    return raw
            except urllib.error.HTTPError as e:
                if check_cancel:
                    e.close()
                    raise KgApiError(f"HTTP {e.code}: {e.reason}") from e
                raw = e.read()
                if e.headers.get("Content-Encoding") == "gzip":
                    try:
                        raw = gzip.decompress(raw)
                    except OSError:
                        pass
                snippet = raw[:500].decode("utf-8", "replace")
                raise KgApiError(f"HTTP {e.code}: {snippet}") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last_err = e
                if attempt < retries:
                    time.sleep(1 + attempt)
        raise KgApiError(f"网络错误: {last_err}")

    def _get_json(self, url, params, headers):
        q = urllib.parse.urlencode(params)
        raw = self._http(f"{url}?{q}", headers)
        try:
            return json.loads(raw)
        except ValueError:
            return json.loads(gzip.decompress(raw))

    # ---------------- 歌词 / 搜索（lite 签名，实测） ----------------
    def _lite_headers(self, module, ms):
        return {
            "User-Agent": UA_LITE.format(module=module),
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip, deflate",
            "KG-Rec": "1", "KG-RC": "1",
            "KG-CLIENTTIMEMS": str(ms), "mid": self.mid,
        }

    def _lite_signed(self, params):
        ms = int(time.time() * 1000)
        p = {k: str(v) for k, v in params.items()}
        p.update(appid=str(LITE_APPID), clientver=str(LITE_CLIENTVER),
                 mid=self.mid, clienttime=str(ms // 1000))
        p["signature"] = _sign(p, LITE_SALT)
        return p, ms

    def search_song(self, keyword, page=1, pagesize=30):
        """公开歌曲搜索，返回 [{name, singers, hash, duration_ms, mixsongid}]"""
        ms = int(time.time() * 1000)
        p = {
            "keyword": keyword, "page": page, "pagesize": pagesize, "sorttype": "0",
            "userid": "0", "appid": str(LITE_APPID), "token": "",
            "clienttime": str(ms // 1000), "iscorrection": "1", "uuid": "-",
            "mid": self.mid, "dfid": self.dfid,
            "clientver": str(LITE_CLIENTVER), "platform": "AndroidFilter",
        }
        p["signature"] = _sign(p, LITE_SALT)
        headers = self._lite_headers("SearchSong", ms)
        headers["x-router"] = "complexsearch.kugou.com"
        data = self._get_json("http://complexsearch.kugou.com/v2/search/song", p, headers)
        _dump("search_song", data)
        lists = (data.get("data") or {}).get("lists") or []
        out = []
        for it in lists:
            singers = "、".join(s.get("name", "") for s in it.get("Singers") or [])
            out.append({
                "name": it.get("SongName") or "",
                "singers": singers,
                "hash": (it.get("FileHash") or "").upper(),
                "duration_ms": (it.get("Duration") or 0) * 1000,
                "mixsongid": it.get("MixSongID"),
            })
        return [s for s in out if s["hash"]]

    def search_cover(self, title, artist, fhash):
        """按「歌名 歌手」搜索，取同一 FileHash 的封面图（playInfo 的 album_img 为空时兜底）。

        FileHash 与库内一致即同一份音频文件，不会错配到别的翻唱/版本。
        返回 {"img": 模板 URL, "kind": "album"/"singer", "album": 专辑名, "album_id": ...}，
        找不到返回 None。kind=singer 表示酷狗对该曲只有歌手头像，没有专辑图。
        """
        keyword = f"{str(title).strip()} {str(artist).strip()}".strip()
        if not keyword:
            return None
        params = {
            "keyword": keyword, "page": 1, "pagesize": 10, "platform": "WebFilter",
            "userid": "0", "clientver": "2000", "iscorrection": "1",
            "privilege_filter": "0", "filter": "10",
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Encoding": "gzip",
        }
        data = self._get_json("https://songsearch.kugou.com/song_search_v2", params, headers)
        _dump("search_cover", data)
        want = str(fhash).upper()
        for it in (data.get("data") or {}).get("lists") or []:
            if (it.get("FileHash") or "").upper() != want:
                continue
            img = (it.get("Image") or "").strip()
            if not img:
                return None
            return {
                "img": img,
                "kind": "album" if "imge.kugou.com/stdmusic" in img else "singer",
                "album": (it.get("AlbumName") or "").strip(),
                "album_id": str(it.get("AlbumID") or "").strip(),
            }
        return None

    def lyric_candidates(self, fhash, duration_ms=0, keyword="", album_audio_id=None):
        fhash = str(fhash).upper()
        p = {"hash": fhash, "lrctxt": "1", "man": "no"}
        if duration_ms:
            p["duration"] = str(duration_ms)
        if keyword:
            p["keyword"] = keyword
        if album_audio_id:
            p["album_audio_id"] = str(album_audio_id)
        sp, ms = self._lite_signed(p)
        headers = self._lite_headers("Lyric", ms)
        data = self._get_json("https://lyrics.kugou.com/v1/search", sp, headers)
        _dump("lyric_search", data)
        cands = data.get("candidates") or []
        if not cands:  # 兜底：老接口（无签名）
            try:
                q = urllib.parse.urlencode({
                    "ver": 1, "man": "yes", "client": "mobi",
                    "keyword": keyword or "", "duration": duration_ms, "hash": fhash,
                })
                raw = self._http(f"http://krcs.kugou.com/search?{q}",
                                 {"User-Agent": UA_LITE.format(module="Lyric")})
                data2 = json.loads(raw)
                _dump("lyric_search_old", data2)
                cands = data2.get("candidates") or []
            except (KgApiError, ValueError):
                pass
        return cands

    def lyric_download(self, cand_id, accesskey, fmt="krc"):
        sp, ms = self._lite_signed({
            "accesskey": accesskey, "charset": "utf8", "client": "mobi",
            "fmt": fmt, "id": str(cand_id), "ver": "1",
        })
        headers = self._lite_headers("Lyric", ms)
        data = self._get_json("http://lyrics.kugou.com/download", sp, headers)
        _dump("lyric_download", data)
        return data

    def fetch_lyrics(self, fhash, duration_ms=0, keyword="", album_audio_id=None,
                     title="", artist=""):
        """获取歌词：优先 KRC 逐字，失败退 LRC。制作信息行会被标记 credit。

        返回 {"type": "krc"/"lrc", "timeline": {...}, "text": 纯文本}
        无歌词返回 None。
        """
        cands = self.lyric_candidates(fhash, duration_ms, keyword, album_audio_id)
        if not cands:
            return None
        best = cands[0]
        # fmt=krc
        try:
            dl = self.lyric_download(best["id"], best["accesskey"], "krc")
            if dl.get("content"):
                raw = base64.b64decode(dl["content"])
                if dl.get("contenttype") == "2" or not kg_krc.looks_like_krc(raw):
                    text = raw.decode("utf-8", "replace").lstrip("\ufeff")
                    tl = kg_krc.parse_lrc(text)
                    kg_krc.mark_credit_lines(tl, title, artist)
                    return {"type": "lrc", "timeline": tl,
                            "text": kg_krc.timeline_to_plain_text(tl)}
                krc_text = kg_krc.decrypt_krc(raw)
                tl = kg_krc.parse_krc(krc_text)
                kg_krc.mark_credit_lines(tl, title, artist)
                if tl["lines"]:
                    return {"type": "krc", "timeline": tl,
                            "text": kg_krc.timeline_to_plain_text(tl)}
        except (KgApiError, kg_krc.KrcDecryptError, ValueError) as e:
            _dump("krc_failed", {"hash": fhash, "err": str(e)})
        # 退 LRC
        try:
            dl = self.lyric_download(best["id"], best["accesskey"], "lrc")
            if dl.get("content"):
                text = base64.b64decode(dl["content"]).decode("utf-8", "replace").lstrip("\ufeff")
                tl = kg_krc.parse_lrc(text)
                kg_krc.mark_credit_lines(tl, title, artist)
                if tl["lines"]:
                    return {"type": "lrc", "timeline": tl,
                            "text": kg_krc.timeline_to_plain_text(tl)}
        except (KgApiError, ValueError) as e:
            _dump("lrc_failed", {"hash": fhash, "err": str(e)})
        return None

    # ---------------- 扫码登录（web 签名，login-user.kugou.com） ----------------
    def _login_headers(self, clienttime):
        return {
            "User-Agent": UA_ANDROID,
            "dfid": self.dfid,
            "clienttime": str(clienttime),
            "mid": self.mid,
            "kg-rc": "1", "kg-thash": "5d816a0",
            "kg-rec": "1", "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
            "Accept-Encoding": "gzip, deflate",
        }

    def _login_signed_params(self, extra):
        """给新二维码流程签名，沿用设备标识。"""
        p = {
            "dfid": self.dfid, "mid": self.mid, "uuid": "-",
            "appid": str(APPID), "clientver": str(CLIENTVER),
            "clienttime": str(int(time.time())),
        }
        p.update({k: str(v) for k, v in extra.items()})
        p["signature"] = _sign(p, WEB_SALT)
        return p

    def qr_create_key(self):
        """生成登录二维码 key。"""
        params = self._login_signed_params({
            # 手机确认页把 1001 显示为酷狗 PC 端。
            "appid": 1001, "type": 1, "plat": 4, "srcappid": SRCAPPID,
            "qrcode_txt": f"https://h5.kugou.com/apps/loginQRCode/html/index.html?appid={APPID}&",
        })
        data = self._get_json("https://login-user.kugou.com/v2/qrcode", params,
                              self._login_headers(params["clienttime"]))
        _dump("qr_create", data)
        d = data.get("data") or {}
        key = d.get("qrcode") or d.get("qrcode_txt") or d.get("key")
        if not key:
            raise KgApiError(f"二维码 key 获取失败: {json.dumps(data, ensure_ascii=False)[:300]}")
        return str(key)

    def qr_status(self, key):
        """返回 data 部分：status 0=过期 1=等待扫码 2=待确认 4=成功(含 token/userid)。"""
        params = self._login_signed_params({
            # 轮询获取后续安卓网关请求所用的会话。
            "plat": 4, "appid": APPID, "srcappid": SRCAPPID, "qrcode": key,
        })
        data = self._get_json("https://login-user.kugou.com/v2/get_userinfo_qrcode",
                              params, self._login_headers(params["clienttime"]))
        payload = data.get("data") or {}
        _dump("qr_status", {"status": data.get("status"), "error_code": _error_code(data),
                            "qr_state": payload.get("status")})
        if data.get("status") not in (1, 200) and data.get("error_code") not in (0, None, 200):
            raise KgApiError(f"二维码状态查询失败（错误码 {_error_code(data)}）")
        return payload

    def qr_content_url(self, key) -> str:
        return f"https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode={key}"

    # ---------------- 用户歌单（android 签名，gateway.kugou.com） ----------------
    def _gateway_headers(self, clienttime, x_router=None, json_body=False):
        h = {
            "User-Agent": UA_ANDROID,
            "dfid": self.dfid,
            "clienttime": str(clienttime),
            "mid": self.mid,
            "kg-rc": "1", "kg-thash": "5d816a0",
            "kg-rec": "1", "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
            "Accept-Encoding": "gzip, deflate",
        }
        if json_body:
            h["Content-Type"] = "application/json;charset=utf-8"
        if x_router:
            h["x-router"] = x_router
        return h

    def _android_signed(self, extra_params):
        ms = int(time.time() * 1000)
        p = {
            "dfid": self.dfid, "mid": self.mid, "uuid": "-",
            "appid": str(APPID), "clientver": str(CLIENTVER),
            "clienttime": str(ms // 1000),
        }
        if self.token:
            p["token"] = self.token
        if self.userid and self.userid != "0":
            p["userid"] = self.userid
        p.update({k: str(v) for k, v in extra_params.items()})
        p["signature"] = _sign(p, ANDROID_SALT)
        return p, ms

    def _post_gateway(self, path, query_extra, body_dict, x_router):
        """POST gateway.kugou.com，android 签名覆盖 query 与 body 字符串。"""
        params, _ = self._android_signed(query_extra)
        body = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))
        params["signature"] = _sign({k: v for k, v in params.items() if k != "signature"},
                                    ANDROID_SALT, body)
        q = urllib.parse.urlencode(params)
        raw = self._http(f"https://gateway.kugou.com{path}?{q}",
                         self._gateway_headers(params["clienttime"], x_router, json_body=True),
                         data=body)
        try:
            data = json.loads(raw)
        except ValueError:
            data = json.loads(gzip.decompress(raw))
        _dump(path.replace("/", "_"), data)
        if data.get("status") == 0 or (data.get("error_code") not in (None, 0, 200)
                                       and data.get("status") != 1):
            raise KgApiError(f"{path} 失败: {json.dumps(data, ensure_ascii=False)[:300]}",
                             code=_error_code(data))
        return data

    def user_playlists(self, page=1, pagesize=100):
        """获取用户所有歌单（含“我喜欢”收藏夹）。"""
        data = self._post_gateway(
            "/v7/get_all_list",
            {"plat": 1, "userid": self.userid, "token": self.token},
            {"userid": self.userid, "token": self.token, "total_ver": 979,
             "type": 2, "page": page, "pagesize": pagesize},
            x_router="cloudlist.service.kugou.com",
        )
        items = _dig_list(data.get("data") or data) or []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or it.get("listname") or it.get("specialname") or "")
            out.append({
                "listid": it.get("listid", it.get("list_id")),
                "gid": it.get("global_collection_id") or it.get("globalCollectionId"),
                "name": name,
                "count": int(it.get("count") or it.get("songcount") or 0),
                "raw": it,
            })
        return out

    def playlist_tracks(self, listid, gid=None, page=1, pagesize=300):
        """拉取歌单内全部歌曲，自动翻页。优先 v3 云歌单接口，失败退 pubsongs v2。"""
        tracks = []
        p = page
        while True:
            got = self._playlist_tracks_v3(listid, p, pagesize)
            if got is None:
                got = self._playlist_tracks_pub(gid, p, pagesize)
                if got is None:
                    break
            tracks.extend(got)
            if len(got) < pagesize:
                break
            p += 1
        return tracks

    def _playlist_tracks_v3(self, listid, page, pagesize):
        try:
            data = self._post_gateway(
                "/v4/get_list_all_file_v3",
                {},
                {"listid": listid, "userid": self.userid, "type": 0, "page": page,
                 "pagesize": pagesize, "area_code": 1, "allplatform": 1,
                 "show_cover": 1, "token": self.token},
                x_router="cloudlist.service.kugou.com",
            )
        except KgApiError:
            return None
        d = data.get("data") or {}
        items = _dig_list(d) or []
        return [_norm_track(it) for it in items if isinstance(it, dict)]

    def _playlist_tracks_pub(self, gid, page, pagesize):
        if not gid:
            return None
        try:
            params, ms = self._android_signed({
                "area_code": 1, "begin_idx": (page - 1) * pagesize, "plat": 1,
                "type": 1, "mode": 1, "personal_switch": 1,
                "extend_fields": "abtags,hot_cmt,popularization",
                "pagesize": pagesize, "global_collection_id": gid,
            })
            q = urllib.parse.urlencode(params)
            raw = self._http(
                f"https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt?{q}",
                self._gateway_headers(ms))
            try:
                data = json.loads(raw)
            except ValueError:
                data = json.loads(gzip.decompress(raw))
            _dump("pubsongs", data)
            items = _dig_list(data.get("data") or data) or []
            return [_norm_track(it) for it in items if isinstance(it, dict)]
        except (KgApiError, ValueError):
            return None


    # ---------------- 播放地址（/v5/url，参考 KuGouMusicApi module/song_url.js） ----------------
    def song_url(self, fhash, album_audio_id=None, quality=128):
        """获取播放直链（登录态）。返回响应 dict；失败抛 KgApiError。"""
        fhash = str(fhash).lower()
        params = {
            "album_id": 0, "area_code": 1, "hash": fhash,
            "ssa_flag": "is_fromtrack", "version": 11430,
            "page_id": 151369488, "quality": quality,
            "album_audio_id": int(album_audio_id or 0),
            "behavior": "play", "pid": 2, "cmd": 26, "pidversion": 3001,
            "IsFreePart": 0, "ppage_id": "463467626,350369493,788954147",
            "cdnBackup": 1, "module": "", "clientver": 11430,
            "dfid": self.dfid, "mid": self.mid, "uuid": "-",
            "appid": str(APPID), "clienttime": str(int(time.time())),
        }
        if self.token:
            params["token"] = self.token
        if self.userid and self.userid != "0":
            params["userid"] = self.userid
        # 专属 key：md5(hash + 盐 + appid + mid + userid)，再对含 key 的全部参数做 android 签名
        params["key"] = _md5(f"{fhash}57ae12eb6890223e355ccfcb74edf70d"
                             f"{APPID}{self.mid}{self.userid or 0}")
        params["signature"] = _sign(params, ANDROID_SALT)
        headers = self._gateway_headers(params["clienttime"],
                                        x_router="trackercdn.kugou.com")
        data = self._get_json("https://gateway.kugou.com/v5/url", params, headers)
        _dump("song_url", data)
        return data

    def song_url_legacy(self, fhash):
        """免登录兜底：老 playInfo 接口（folia-major 亦用它做最后回退）。"""
        q = urllib.parse.urlencode({"cmd": "playInfo", "hash": str(fhash).upper()})
        raw = self._http(
            f"https://m.kugou.com/app/i/getSongInfo.php?{q}",
            {"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 "
                           "Chrome/124.0.0.0 Mobile Safari/537.36"})
        try:
            data = json.loads(raw)
        except ValueError:
            data = json.loads(gzip.decompress(raw))
        _dump("song_url_legacy", data)
        return data

    # 网页播放的音质优先级：无损 → 高品 → 标准（VIP 未覆盖或曲目无该档时逐级回落）
    PLAY_QUALITY_CHAIN = ("flac", "320", "128")
    _QUALITY_RANK = {"flac": 3, "320": 2, "128": 1}

    def resolve_play_url(self, fhash, album_audio_id=None, quality=128):
        """为制作任务取单档播放地址。返回 (url, 来源) 或 (None, 原因)。"""
        try:
            url, _, note = self.resolve_play_url_best(fhash, album_audio_id, (quality,))
        except KgLoginRequired as e:
            return None, str(e)
        return url, note

    @staticmethod
    def _play_urls(data):
        """响应里全部可用直链（url + backupUrl 去重），近期连不通的节点排后面。"""
        if not isinstance(data, dict):
            return []
        raw = data.get("url") or []
        if isinstance(raw, (str, dict)):
            raw = [raw]
        urls = []
        for item in raw if isinstance(raw, list) else []:
            url = item.get("url") if isinstance(item, dict) else item
            if isinstance(url, str) and url.startswith(("https://", "http://")) and url not in urls:
                urls.append(url)
        for url in data.get("backupUrl") or []:
            if isinstance(url, str) and url.startswith(("https://", "http://")) and url not in urls:
                urls.append(url)
        now = time.monotonic()
        healthy = [u for u in urls
                   if _HOST_PENALTY.get(urllib.parse.urlsplit(u).hostname or "", 0) <= now]
        return healthy + [u for u in urls if u not in healthy]

    def play_candidates(self, fhash, album_audio_id=None, qualities=PLAY_QUALITY_CHAIN):
        """按音质优先级取候选直链列表，返回 (urls, 真实音质, 来源)；全拿不到返回 ([], "", 原因)。"""
        codes = set()
        degraded = None
        for quality in qualities:
            try:
                data = self.song_url(fhash, album_audio_id, quality)
            except (KgApiError, ValueError, OSError):
                continue
            urls = self._play_urls(data)
            if not urls:
                if isinstance(data, dict):
                    codes.add(_error_code(data))
                continue
            actual = self._decode_quality(data)
            # 服务端给的档位 >= 请求档位才算数，否则继续往下一档要
            if self._QUALITY_RANK.get(actual, 0) >= self._QUALITY_RANK.get(str(quality), 0):
                return urls, actual, "v5"
            if degraded is None or self._QUALITY_RANK[actual] > self._QUALITY_RANK[degraded[1]]:
                degraded = (urls, actual, "v5")
        if degraded:
            return degraded
        # 三档都没地址，才接受 legacy 的标准音质
        try:
            urls = self._play_urls(self.song_url_legacy(fhash))
            if urls:
                return urls, "128", "legacy"
        except (KgApiError, ValueError, OSError):
            pass
        if codes & {"152", "20018", "20028"}:
            if not self.logged_in:
                raise KgLoginRequired("请运行 py -3 kg_cli.py login 扫码登录酷狗。")
            # 取流拒绝也可能是单曲权限问题，用账号请求确认登录状态。
            try:
                self.user_playlists(pagesize=1)
            except KgApiError as e:
                if e.code in {"152", "20017", "20018", "20028"}:
                    raise KgLoginRequired(_RELOGIN) from e
            except (ValueError, OSError):
                pass
        return [], "", "酷狗暂时未提供这首歌的播放地址。"

    def resolve_play_url_best(self, fhash, album_audio_id=None, qualities=PLAY_QUALITY_CHAIN,
                              exclude_url=None):
        """兼容入口：取候选首链，返回 (url, 真实音质, 来源)。"""
        urls, actual, note = self.play_candidates(fhash, album_audio_id, qualities)
        if exclude_url:
            urls = [u for u in urls if u != exclude_url] or urls
        return (urls[0] if urls else None), actual, note

    @staticmethod
    def _decode_quality(data):
        """读出响应里**真实**的音质档位。

        坑：曲库没有无损时，请求 flac 并不会报错，而是静默下发改成 128k 的 mp3
        （extName=mp3 / bitRate=128000）。只看"有没有 url"会把 128k 当无损用，
        比直接请求 320 还差，所以必须按 extName / bitRate 回判真实档位。
        """
        ext = str(data.get("extName") or "").lower()
        try:
            rate = int(data.get("bitRate") or 0)
        except (TypeError, ValueError):
            rate = 0
        if ext == "flac" or rate >= 700000:
            return "flac"
        if rate >= 300000:
            return "320"
        return "128"

    def download_file(self, url, dest_path, max_mb=60, timeout=60):
        """流式下载文件到 dest_path（先写 .part，完整后再原子替换）。

        中途失败/超限时删掉临时文件，避免半截文件被后续制作当成完整缓存。
        """
        tmp_path = f"{dest_path}.part"
        req = urllib.request.Request(url, headers={"User-Agent": UA_ANDROID})
        check_cancel = self._check_cancel
        try:
            if check_cancel:
                check_cancel()
            deadline = time.monotonic() + timeout
            socket_timeout = min(timeout, 6) if check_cancel else timeout
            with urllib.request.urlopen(req, timeout=socket_timeout) as r, open(tmp_path, "wb") as f:
                total = 0
                chunks = (_response_chunks(r, deadline, check_cancel) if check_cancel
                          else iter(lambda: r.read(65536), b""))
                for chunk in chunks:
                    total += len(chunk)
                    if total > max_mb * 1024 * 1024:
                        raise KgApiError(f"文件超过 {max_mb}MB 上限")
                    f.write(chunk)
            if check_cancel:
                check_cancel()
            os.replace(tmp_path, dest_path)
        except BaseException:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
        return os.path.getsize(dest_path)


# ---------------- 工具 ----------------

def _dig_list(obj, depth=0):
    """从嵌套响应里挖出第一个像是歌曲/歌单列表的数组。"""
    if depth > 3:
        return None
    if isinstance(obj, list):
        return obj if obj else None
    if not isinstance(obj, dict):
        return None
    for key in ("songs", "lists", "list", "info", "track", "items", "data"):
        v = obj.get(key)
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    for v in obj.values():
        if isinstance(v, (dict, list)):
            r = _dig_list(v, depth + 1)
            if r:
                return r
    return None


def _norm_track(it: dict) -> dict:
    """歌单条目 → {title, artist, hash, duration_ms, mixsongid}"""
    title = it.get("SongName") or it.get("songname") or it.get("name") or ""
    artist = it.get("SingerName") or it.get("singername") or it.get("singer") or ""
    audio = it.get("audio_name") or it.get("filename") or ""
    if audio and " - " in audio and (not title or not artist):
        a, _, b = audio.partition(" - ")
        artist = artist or a
        title = title or b
    # 云歌单接口常把 "歌手 - 歌名" 整个塞进 name：歌手缺失时拆开
    if (not artist or artist == "未知歌手") and " - " in title:
        a, _, b = title.partition(" - ")
        if a.strip() and b.strip():
            artist, title = a.strip(), b.strip()
    dur = it.get("Duration") or it.get("duration") or 0
    dur = int(dur) if dur else 0
    if 0 < dur < 10000:  # 秒 → 毫秒
        dur *= 1000
    mix = it.get("MixSongID") or it.get("mixsongid") or it.get("EMixSongID") \
        or it.get("album_audio_id") or ""
    return {
        "title": str(title or "未知歌曲"),
        "artist": str(artist or "未知歌手"),
        "hash": str(it.get("FileHash") or it.get("hash") or it.get("filehash") or "").upper(),
        "duration_ms": dur,
        "mixsongid": str(mix) if mix not in (None, "") else "",
    }
