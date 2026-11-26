# -*- coding: utf-8 -*-
"""零依赖纯 Python QR Code 编码器（ISO/IEC 18004，Byte 模式，纠错等级 M，支持 Version 1~10）。"""

# (total_codewords, ec_per_block, group1_blocks, group1_data, group2_blocks, group2_data, align_centers)
_VERSIONS_M = {
    1:  (26,  10, 1, 16, 0, 0,  []),
    2:  (44,  16, 1, 28, 0, 0,  [6, 18]),
    3:  (70,  26, 1, 44, 0, 0,  [6, 22]),
    4:  (100, 18, 2, 32, 0, 0,  [6, 26]),
    5:  (134, 24, 2, 43, 0, 0,  [6, 30]),
    6:  (172, 16, 4, 27, 0, 0,  [6, 34]),
    7:  (196, 18, 4, 31, 0, 0,  [6, 22, 38]),
    8:  (242, 22, 2, 38, 2, 39, [6, 24, 42]),
    9:  (292, 22, 3, 36, 2, 37, [6, 26, 46]),
    10: (346, 26, 4, 43, 1, 44, [6, 28, 50]),
}

# GF(256) with primitive polynomial 0x11D
_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _rs_gen(degree: int) -> list[int]:
    poly = [1]
    for i in range(degree):
        factor = [1, _EXP[i]]
        nxt = [0] * (len(poly) + 1)
        for j, a in enumerate(poly):
            nxt[j] ^= _gf_mul(a, factor[0])
            nxt[j + 1] ^= _gf_mul(a, factor[1])
        poly = nxt
    return poly


def _rs_encode(data: list[int], ec_len: int) -> list[int]:
    gen = _rs_gen(ec_len)
    rem = [0] * ec_len
    for b in data:
        lead = b ^ rem[0]
        rem = rem[1:] + [0]
        if lead:
            for j in range(ec_len):
                rem[j] ^= _gf_mul(gen[j + 1], lead)
    return rem


def _pick_version(byte_len: int) -> int:
    for v, (_, _, g1b, g1d, g2b, g2d, _) in _VERSIONS_M.items():
        cap = g1b * g1d + g2b * g2d
        count_bits = 8 if v <= 9 else 16
        if (4 + count_bits + byte_len * 8 + 7) // 8 <= cap:
            return v
    raise ValueError(f"内容过长（{byte_len} 字节），超出 QR Version 10 容量")


def _encode_codewords(payload: bytes, version: int) -> list[int]:
    _, ec_len, g1b, g1d, g2b, g2d, _ = _VERSIONS_M[version]
    data_cap = g1b * g1d + g2b * g2d
    bits: list[int] = []

    def push(val: int, width: int):
        for shift in range(width - 1, -1, -1):
            bits.append((val >> shift) & 1)

    push(0b0100, 4)  # Byte mode
    push(len(payload), 8 if version <= 9 else 16)
    for b in payload:
        push(b, 8)
    term = min(4, data_cap * 8 - len(bits))
    push(0, term)
    while len(bits) % 8:
        bits.append(0)
    data = [
        sum(bits[i + k] << (7 - k) for k in range(8))
        for i in range(0, len(bits), 8)
    ]
    pad = (0xEC, 0x11)
    idx = 0
    while len(data) < data_cap:
        data.append(pad[idx & 1])
        idx += 1

    blocks_data: list[list[int]] = []
    blocks_ec: list[list[int]] = []
    pos = 0
    for count, size in ((g1b, g1d), (g2b, g2d)):
        for _ in range(count):
            chunk = data[pos:pos + size]
            pos += size
            blocks_data.append(chunk)
            blocks_ec.append(_rs_encode(chunk, ec_len))

    out: list[int] = []
    max_d = max(len(b) for b in blocks_data)
    for i in range(max_d):
        for b in blocks_data:
            if i < len(b):
                out.append(b[i])
    for i in range(ec_len):
        for e in blocks_ec:
            out.append(e[i])
    return out


def _format_bits(mask: int) -> int:
    # EC Level M = 00
    data = (0b00 << 3) | mask
    rem = data << 10
    for shift in range(4, -1, -1):
        if rem & (1 << (shift + 10)):
            rem ^= 0x537 << shift
    return ((data << 10) | rem) ^ 0x5412


def _version_bits(version: int) -> int:
    rem = version << 12
    for shift in range(5, -1, -1):
        if rem & (1 << (shift + 12)):
            rem ^= 0x1F25 << shift
    return (version << 12) | rem


def _build_matrix(text: str) -> list[list[bool]]:
    payload = text.encode("utf-8")
    version = _pick_version(len(payload))
    size = version * 4 + 17
    codewords = _encode_codewords(payload, version)

    grid = [[False] * size for _ in range(size)]
    func = [[False] * size for _ in range(size)]

    def put(r: int, c: int, val: bool):
        if 0 <= r < size and 0 <= c < size:
            grid[r][c] = val
            func[r][c] = True

    def place_finder(r0: int, c0: int):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                in_box = 0 <= dr <= 6 and 0 <= dc <= 6
                dark = in_box and (
                    dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4)
                )
                put(r0 + dr, c0 + dc, dark)

    place_finder(0, 0)
    place_finder(0, size - 7)
    place_finder(size - 7, 0)

    for i in range(8, size - 8):
        put(6, i, (i & 1) == 0)
        put(i, 6, (i & 1) == 0)

    centers = _VERSIONS_M[version][6]
    for r in centers:
        for c in centers:
            if func[r][c]:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    dark = max(abs(dr), abs(dc)) != 1
                    put(r + dr, c + dc, dark)

    # Reserve format info + dark module
    for i in range(9):
        if i != 6:
            put(8, i, False)
            put(i, 8, False)
    for i in range(8):
        put(8, size - 1 - i, False)
        put(size - 1 - i, 8, False)
    put(4 * version + 9, 8, True)

    if version >= 7:
        vbits = _version_bits(version)
        for i in range(18):
            bit = bool((vbits >> i) & 1)
            r, c = i // 3, size - 11 + (i % 3)
            put(r, c, bit)
            put(c, r, bit)

    # Place data bits
    bit_stream = [(cw >> s) & 1 for cw in codewords for s in range(7, -1, -1)]
    bi = 0
    up = True
    col = size - 1
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if up else range(size)
        for r in rows:
            for dc in (0, -1):
                c = col + dc
                if not func[r][c]:
                    grid[r][c] = bool(bit_stream[bi]) if bi < len(bit_stream) else False
                    bi += 1
        up = not up
        col -= 2

    def apply_format(m: list[list[bool]], mask: int):
        fb = _format_bits(mask)
        for i in range(6):
            bit = bool((fb >> i) & 1)
            m[8][size - 1 - i] = bit
            m[i][8] = bit
        m[7][8] = bool((fb >> 6) & 1)
        m[8][size - 7] = bool((fb >> 6) & 1)
        m[8][8] = bool((fb >> 7) & 1)
        m[8][size - 8] = bool((fb >> 7) & 1)
        m[8][7] = bool((fb >> 8) & 1)
        m[size - 7][8] = bool((fb >> 8) & 1)
        for i in range(9, 15):
            bit = bool((fb >> i) & 1)
            m[8][14 - i] = bit
            m[size - 15 + i][8] = bit

    masks = (
        lambda r, c: (r + c) % 2 == 0,
        lambda r, c: r % 2 == 0,
        lambda r, c: c % 3 == 0,
        lambda r, c: (r + c) % 3 == 0,
        lambda r, c: (r // 2 + c // 3) % 2 == 0,
        lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
        lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
        lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
    )

    def penalty(m: list[list[bool]]) -> int:
        score = 0
        # Rule 1: consecutive modules
        for line in m:
            run = 1
            for i in range(1, size):
                if line[i] == line[i - 1]:
                    run += 1
                    if run == 5:
                        score += 3
                    elif run > 5:
                        score += 1
                else:
                    run = 1
        for c in range(size):
            run = 1
            for r in range(1, size):
                if m[r][c] == m[r - 1][c]:
                    run += 1
                    if run == 5:
                        score += 3
                    elif run > 5:
                        score += 1
                else:
                    run = 1
        # Rule 2: 2x2 blocks
        for r in range(size - 1):
            for c in range(size - 1):
                v = m[r][c]
                if v == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                    score += 3
        # Rule 4: dark ratio
        dark = sum(cell for row in m for cell in row)
        diff = abs(dark * 100 // (size * size) - 50) // 5
        score += diff * 10
        return score

    best_mat = None
    best_score = 10**9
    for idx, fn in enumerate(masks):
        cand = [
            [grid[r][c] ^ (not func[r][c] and fn(r, c)) for c in range(size)]
            for r in range(size)
        ]
        apply_format(cand, idx)
        sc = penalty(cand)
        if sc < best_score:
            best_score = sc
            best_mat = cand
    return best_mat


def render_svg(text: str, *, quiet: int = 3, fg: str = "#1c1917", bg: str = "#ffffff") -> str:
    """将字符串编码为紧凑矢量 SVG 二维码。"""
    mat = _build_matrix(text)
    size = len(mat)
    vb = size + quiet * 2
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" '
        f'shape-rendering="crispEdges" role="img" aria-label="酷狗扫码登录二维码">',
        f'<rect width="{vb}" height="{vb}" fill="{bg}"/>',
    ]
    d_cmds = []
    for r, row in enumerate(mat):
        y = r + quiet
        c = 0
        while c < size:
            if row[c]:
                start = c
                while c < size and row[c]:
                    c += 1
                d_cmds.append(f"M{start + quiet} {y}h{c - start}v1h-{c - start}z")
            else:
                c += 1
    parts.append(f'<path fill="{fg}" d="{"".join(d_cmds)}"/>')
    parts.append("</svg>")
    return "".join(parts)
