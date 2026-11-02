import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

base_url = "http://127.0.0.1:8000"

print("=== 1. Health Endpoint Verification ===")
resp = urllib.request.urlopen(f"{base_url}/api/health")
health = json.loads(resp.read().decode("utf-8"))
assert health["status"] == "ok"
print(f"✓ Health: {health['status']}, Gemini Configured: {health['gemini_api_configured']}, MP: {health.get('mp_api_configured')}")

print("\n=== 2. Existing Projects & Saved Runs Verification ===")
resp = urllib.request.urlopen(f"{base_url}/api/projects")
projects = json.loads(resp.read().decode("utf-8"))
print(f"✓ Total existing projects in DB: {len(projects)}")
assert len(projects) > 0, "No projects in DB!"

# Find a project that has both XRD and SEM results (e.g. TiO2)
target_proj = None
for p in projects:
    if "TiO2" in p.get("sample_name", ""):
        target_proj = p
        break

if not target_proj:
    target_proj = projects[1]

pid = target_proj["id"]

# Fetch project detail
resp = urllib.request.urlopen(f"{base_url}/api/projects/{pid}")
proj_detail = json.loads(resp.read().decode("utf-8"))
rid = proj_detail.get("latest_run_id") or (proj_detail.get("runs", [{}])[0].get("id"))
print(f"✓ Selected Project: {proj_detail['sample_name']} (ID: {pid}), Run ID: {rid}")
print(f"✓ Project Detail fetched: {proj_detail['sample_name']}, Files: {len(proj_detail.get('files', []))}")

# Fetch run detail
resp = urllib.request.urlopen(f"{base_url}/api/runs/{rid}")
run_detail = json.loads(resp.read().decode("utf-8"))
assert run_detail["status"] == "completed", f"Run status is {run_detail['status']}"
print(f"✓ Run Detail fetched: status={run_detail['status']}")

# Check XRD results
xrd_res = run_detail.get("xrd_result")
assert xrd_res is not None, "XRD result missing!"
peaks = xrd_res.get("peaks", [])
cands = xrd_res.get("phase_matching", {}).get("candidates", [])
top_cand = cands[0] if cands else {}
print(f"✓ Existing XRD Results Intact: Detected peaks = {len(peaks)}, Top match phase = {top_cand.get('name')} (Score: {top_cand.get('score')})")

# Check SEM results
sem_res = run_detail.get("sem_result")
assert sem_res is not None, "SEM result missing!"
stats = sem_res.get("summary_stats", {})
print(f"✓ Existing SEM Results Intact: D50 = {stats.get('d50')} {stats.get('unit')}, Count = {stats.get('sample_count_n')}")

# Check existing PDF report download
resp = urllib.request.urlopen(f"{base_url}/api/runs/{rid}/download/pdf")
pdf_bytes = resp.read()
assert len(pdf_bytes) > 5000, f"PDF too small: {len(pdf_bytes)} bytes"
print(f"✓ Existing Integrated PDF Download Intact: {len(pdf_bytes)} bytes received")

# Check existing XRD CSV download
resp = urllib.request.urlopen(f"{base_url}/api/runs/{rid}/download/xrd-peaks.csv")
csv_bytes = resp.read()
assert len(csv_bytes) > 100, "XRD CSV download failed"
print(f"✓ Existing XRD CSV Download Intact: {len(csv_bytes)} bytes received")

print("\n>>> ALL EXISTING XRD/SEM CAPABILITIES FULLY PRESERVED AND OPERATIONAL! <<<")
