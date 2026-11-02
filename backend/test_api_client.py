import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

# Build test file
lines = ["일련번호\t시간\t하중\t변위\t응력\t변형율\t진응력\t진변형율", "\tsec\tkgf\tmm\tkgf/mm²\t%\tkgf/mm²\t%"]
for i in range(1, 1099):
    t = round(i * (1.310 / 326.0), 3)
    s = 2.746 if i == 326 else (round(1.0 + (i % 50)*0.01, 4))
    st = 0.83 if i == 326 else (round(0.001 * i, 4))
    l = -1.0 if i >= 1066 else 35.0
    lines.append(f"{i}\t{t}\t{l}\t{st*0.5:.4f}\t{s}\t{st}\t{s*1.01:.4f}\t{st*0.99:.4f}")

data = "\n".join(lines).encode("utf-8")

boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="abs100-3.txt"\r\n'
    f"Content-Type: text/plain\r\n\r\n"
).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")

# 1. /api/utm/parse
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/utm/parse",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
)
resp = urllib.request.urlopen(req)
parsed = json.loads(resp.read().decode("utf-8"))
print(f"✓ /api/utm/parse: {parsed['row_count']} rows, headers: {parsed['headers']}")

# 2. /api/utm/analyze
req2 = urllib.request.Request(
    "http://127.0.0.1:8000/api/utm/analyze",
    data=json.dumps({"parsed_data": parsed, "start_index": 0, "end_index": 1098}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
resp2 = urllib.request.urlopen(req2)
analyzed = json.loads(resp2.read().decode("utf-8"))
ps = analyzed["peak_stress"]
print(f"✓ /api/utm/analyze: Peak stress {ps['stress_MPa']} MPa (raw {ps['stress_raw']} {ps['stress_raw_unit']}) at No. {ps['serial_number']} (Time {ps['time_sec']}s, Strain {ps['strain_pct']}%)")
print(f"✓ Negative load count: {analyzed['negative_load_summary']['count']}")

# 3. /api/utm/download/chart
req_chart = urllib.request.Request(
    "http://127.0.0.1:8000/api/utm/download/chart",
    data=json.dumps({"parsed_data": parsed}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
chart_bytes = urllib.request.urlopen(req_chart).read()
print(f"✓ /api/utm/download/chart: PNG received ({len(chart_bytes)} bytes)")

# 4. /api/utm/download/pdf
req_pdf = urllib.request.Request(
    "http://127.0.0.1:8000/api/utm/download/pdf",
    data=json.dumps({"parsed_data": parsed, "analysis_name": "ABS-100 Test"}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
pdf_bytes = urllib.request.urlopen(req_pdf).read()
print(f"✓ /api/utm/download/pdf: PDF received ({len(pdf_bytes)} bytes)")

# 5. /api/utm/download/csv
req_csv = urllib.request.Request(
    "http://127.0.0.1:8000/api/utm/download/csv",
    data=json.dumps({"parsed_data": parsed}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
csv_bytes = urllib.request.urlopen(req_csv).read()
print(f"✓ /api/utm/download/csv: CSV received ({len(csv_bytes)} bytes)")

print("\n>>> ALL UTM REST API ENDPOINTS TESTED AND WORKING! <<<")
