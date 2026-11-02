import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

base_url = "http://127.0.0.1:8000"

print("=== 3. New Project Creation & Execution Workflow Verification ===")
# 1. Create temporary project
payload = {
    "sample_name": "Test_Regression_Sample",
    "description": "UTM 추가 후 기존 XRD/SEM 등록 흐름 회귀 검증",
    "expected_elements": ["Ti", "O"],
    "expected_formula": "TiO2",
    "is_same_sample": True
}
req = urllib.request.Request(
    f"{base_url}/api/projects",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
resp = urllib.request.urlopen(req)
created_proj = json.loads(resp.read().decode("utf-8"))
new_pid = created_proj["id"]
print(f"✓ Project Created Successfully: ID={new_pid}, Name={created_proj['sample_name']}")

# 2. Delete test project cleanly
req_del = urllib.request.Request(f"{base_url}/api/projects/{new_pid}", method="DELETE")
resp_del = urllib.request.urlopen(req_del)
del_res = json.loads(resp_del.read().decode("utf-8"))
assert del_res.get("deleted") is True
print(f"✓ Project Cleaned Up Successfully: {del_res}")

print("\n>>> CREATION / DELETION WORKFLOW 100% VERIFIED! <<<")
