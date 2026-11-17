import hashlib
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    tc = TestClient(app)
    tc.post("/api/v1/comparison/seed-series", json={"force_reseed": False})
    return tc


def test_1_process_variation_and_confounded_and_unrelated_exclusion(client: TestClient):
    """
    필수 사례 1:
    - 열처리 조건이 다른 같은 조성 시편군 (TiO2 500°C, 700°C, 850°C/4h) 비교군 자동 구성
    - 복수 변수 변경(열처리 온도 500->850 °C + 유지 시간 2->4 h 동시 변경) 시 교란 경고(confounded_warnings) 표시
    - 무관한 재료(Si-SRM640) 기본 비교 후보에서 자동 제외 및 제외 사유 제시
    """
    resp = client.post(
        "/api/v1/comparison/analyze",
        json={
            "question_type": "process_variation",
            "norm_mode": "max_100",
            "offset_step": 115.0,
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["question_type"] == "process_variation"
    assert "공정 변수 비교 리포트" in data["report_title"]

    cand_eval = data["candidate_evaluation"]
    eligible_names = [c["sample_name"] for c in cand_eval["eligible_candidates"]]
    excluded_items = cand_eval["excluded_candidates"]

    # TiO2 열처리 시리즈(500°C, 700°C, 850°C)가 적격 후보에 포함되어야 함
    assert any("500°C" in n for n in eligible_names)
    assert any("700°C" in n for n in eligible_names)
    assert any("850°C" in n for n in eligible_names)

    # 온도 오름차순(500 -> 700 -> 850)으로 정렬되어야 함 (온도가 지정된 후보들)
    temps = [
        c["experiment_meta"]["process_temp_c"]
        for c in cand_eval["eligible_candidates"]
        if c["experiment_meta"]["process_temp_c"] is not None
    ]
    assert temps == sorted(temps)

    # 850°C 시편은 온도(500->850°C)뿐 아니라 유지시간(2->4h)도 함께 달라졌으므로 교란 경고가 있어야 함
    c_850 = next(c for c in cand_eval["eligible_candidates"] if "850°C" in c["sample_name"])
    comp_850 = c_850["comparison_eval"]
    assert len(comp_850["confounded_warnings"]) >= 1
    assert any("유지 시간" in w or "단독 효과로 결론짓지 마십시오" in w for w in comp_850["confounded_warnings"])
    assert len(comp_850["same_conditions"]) >= 1
    assert len(comp_850["changed_conditions"]) >= 2

    # 무관한 재료(Si-SRM640)는 제외 목록에 있어야 하며, 사유가 명시되어야 함
    si_excluded = next((x for x in excluded_items if "Si-SRM640" in x["sample_name"]), None)
    assert si_excluded is not None
    assert "모재 불일치" in (si_excluded["comparison_eval"]["exclusion_reason"] or "")


def test_2_dopant_amount_and_type_and_unit_incompatibility_and_replicates(client: TestClient):
    """
    필수 사례 2:
    - 도펀트 종류(Nb vs Fe, 무도핑 대조군 포함) 또는 함량(0 at%, 2 at% Rep-1/Rep-2, 5 at%) 비교군 구성
    - 함량 오름차순 정렬 및 반복 시편(Rep-1, Rep-2) 간 편차(replicate_deviations) 산출
    - 단위 불일치 시편(5 wt% vs at%)은 같은 수치 축에 놓지 않고 unit_compatible=False 및 경고 표시
    """
    # (A) 도펀트 함량 변화 질문 (dopant_amount)
    resp_amt = client.post(
        "/api/v1/comparison/analyze",
        json={
            "question_type": "dopant_amount",
            "norm_mode": "max_100",
            "offset_step": 115.0,
        },
    )
    assert resp_amt.status_code == 200
    data_amt = resp_amt.json()
    cand_eval = data_amt["candidate_evaluation"]

    # 기본 선택된 slots에는 단위 호환(at%) 시편들만 오름차순(0 -> 2 -> 2 -> 5 at%)으로 들어가야 함
    slot_amounts = [s["experiment_meta"]["dopant_amount"] or 0.0 for s in data_amt["slots"]]
    slot_units = [s["experiment_meta"]["dopant_unit"] for s in data_amt["slots"]]
    assert slot_amounts == sorted(slot_amounts)
    assert all(u == "at%" for u in slot_units)

    # 5 wt% 시편은 unit_compatible == False 로 분류되어 같은 수치 축 배치 금지 경고가 있어야 함
    wt_cand = next(
        (c for c in cand_eval["eligible_candidates"] if "5wt%" in c["sample_name"]),
        None,
    )
    assert wt_cand is not None
    assert wt_cand["comparison_eval"]["unit_compatible"] is False
    assert any(
        "동일 함량 수치 축에 놓지 않고" in w
        for w in wt_cand["comparison_eval"]["confounded_warnings"]
    )

    # 반복 시편(2 at% #1 & Rep2) 편차 계산 확인
    rep_devs = data_amt["replicate_deviations"]
    assert len(rep_devs) >= 1
    assert rep_devs[0]["n_replicates"] == 2
    assert any("Rep2" in s for s in rep_devs[0]["specimen_names"])

    # (B) 도펀트 종류 변화 질문 (dopant_type)
    resp_type = client.post(
        "/api/v1/comparison/analyze",
        json={
            "question_type": "dopant_type",
            "norm_mode": "max_100",
            "offset_step": 115.0,
        },
    )
    assert resp_type.status_code == 200
    data_type = resp_type.json()
    dopants_in_slots = [s["experiment_meta"]["dopant_element"] for s in data_type["slots"]]
    # 무도핑 대조군("")과 Nb, Fe 도펀트 시편이 모두 포함되어야 함
    assert "" in dopants_in_slots
    assert "Nb" in dopants_in_slots
    assert "Fe" in dopants_in_slots


def test_3_sem_image_binding_reorder_fov_switch_reload_and_export(client: TestClient):
    """
    필수 사례 3 (회귀 검증 시나리오):
    - 서로 구별되는 SEM 원본을 가진 시편 A(TiO2-500C, FOV-A1 & FOV-A2 보유)와 시편 B(TiO2-700C, FOV-B1 보유) 준비
    - 시편 순서를 A -> B 에서 B -> A 로 변경
    - 시편 A의 대표 SEM 이미지를 A1(50kX)에서 A2(100kX)로 변경
    - 새로고침(세션 재조회 GET /api/v1/comparison/sessions/{session_id}) 후에도 B -> A 순서 및 A2 대표 이미지 유지 검증
    - 내보내기(JSON, CSV, PNG, PDF) 결과에 B와 A2 원본 식별자(파일명, SHA-256)가 B -> A 순서로 일치하는지 검증
    """
    init_resp = client.post(
        "/api/v1/comparison/analyze",
        json={"question_type": "process_variation"},
    )
    assert init_resp.status_code == 200
    init_data = init_resp.json()
    session_id = init_data["session_id"]

    slot_a = next(s for s in init_data["slots"] if "500°C" in s["sample_name"])
    slot_b = next(s for s in init_data["slots"] if "700°C" in s["sample_name"])

    # 시편 A에는 2개의 SEM 시야(FOV-A1, FOV-A2)가 존재해야 함
    sem_files_a = slot_a["available_sem_files"]
    assert len(sem_files_a) >= 2
    file_a1 = next(f for f in sem_files_a if "A1" in f["fov_label"] or "A1" in f["original_filename"])
    file_a2 = next(f for f in sem_files_a if "A2" in f["fov_label"] or "A2" in f["original_filename"])
    assert file_a1["sha256"] != file_a2["sha256"]

    file_b1 = slot_b["available_sem_files"][0]
    assert file_b1["sha256"] != file_a1["sha256"]
    assert file_b1["sha256"] != file_a2["sha256"]

    # 시편 순서를 B -> A 로 바꾸고, A의 대표 이미지를 A2로 지정하여 분석/세션 갱신
    reordered_resp = client.post(
        "/api/v1/comparison/analyze",
        json={
            "session_id": session_id,
            "question_type": "process_variation",
            "baseline_project_id": slot_a["project_id"],
            "slots": [
                {
                    "project_id": slot_b["project_id"],
                    "xrd_run_id": slot_b["selected_xrd"]["run_id"],
                    "sem_file_id": file_b1["file_id"],
                },
                {
                    "project_id": slot_a["project_id"],
                    "xrd_run_id": slot_a["selected_xrd"]["run_id"],
                    "sem_file_id": file_a2["file_id"],
                },
            ],
        },
    )
    assert reordered_resp.status_code == 200

    # 페이지 새로고침 시뮬레이션: GET /api/v1/comparison/sessions/{session_id}
    reload_resp = client.get(f"/api/v1/comparison/sessions/{session_id}")
    assert reload_resp.status_code == 200
    reloaded = reload_resp.json()

    assert len(reloaded["slots"]) == 2
    # 첫 번째 열은 시편 B (FOV-B1), 두 번째 열은 시편 A (FOV-A2)여야 함
    first_slot = reloaded["slots"][0]
    second_slot = reloaded["slots"][1]

    assert first_slot["project_id"] == slot_b["project_id"]
    assert first_slot["selected_sem"]["file_id"] == file_b1["file_id"]
    assert first_slot["selected_sem"]["sha256"] == file_b1["sha256"]

    assert second_slot["project_id"] == slot_a["project_id"]
    assert second_slot["selected_sem"]["file_id"] == file_a2["file_id"]
    assert second_slot["selected_sem"]["sha256"] == file_a2["sha256"]
    assert "A2" in second_slot["selected_sem"]["fov_label"]

    # 실제 원본 이미지 URL에서 바이트를 가져와 SHA-256 해시가 정확히 일치하는지 검증
    raw_b_resp = client.get(first_slot["selected_sem"]["raw_image_url"])
    assert raw_b_resp.status_code == 200
    assert hashlib.sha256(raw_b_resp.content).hexdigest() == file_b1["sha256"]

    raw_a2_resp = client.get(second_slot["selected_sem"]["raw_image_url"])
    assert raw_a2_resp.status_code == 200
    assert hashlib.sha256(raw_a2_resp.content).hexdigest() == file_a2["sha256"]

    # 내보내기 1: JSON
    exp_json = client.get(f"/api/v1/comparison/sessions/{session_id}/export/result.json")
    assert exp_json.status_code == 200
    exp_data = exp_json.json()
    assert exp_data["slots"][0]["project_id"] == slot_b["project_id"]
    assert exp_data["slots"][1]["selected_sem"]["file_id"] == file_a2["file_id"]

    # 내보내기 2: CSV (피크 표도 B -> A 슬롯 순서 반영)
    exp_csv = client.get(f"/api/v1/comparison/sessions/{session_id}/export/xrd-peaks.csv")
    assert exp_csv.status_code == 200
    csv_lines = [
        ln
        for ln in exp_csv.text.lstrip("\ufeff").strip().splitlines()
        if ln.strip() and not ln.lstrip("\ufeff").startswith("#")
    ]
    assert len(csv_lines) > 2
    assert slot_b["sample_name"] in csv_lines[1]

    # 내보내기 3: Stacked XRD PNG
    exp_png = client.get(f"/api/v1/comparison/sessions/{session_id}/export/xrd-chart.png")
    assert exp_png.status_code == 200
    assert exp_png.content[:8] == b"\x89PNG\r\n\x1a\n"

    # 내보내기 4: 통합 PDF 리포트
    exp_pdf = client.get(f"/api/v1/comparison/sessions/{session_id}/export/report.pdf")
    assert exp_pdf.status_code == 200
    assert exp_pdf.content[:4] == b"%PDF"
    assert len(exp_pdf.content) > 5000


def test_4_xrd_peaks_hkl_secondary_phase_and_out_of_range_vs_not_detected(client: TestClient):
    """
    필수 사례 4:
    - 중첩 피크(54.32° / 54.58°), 미할당 피크(31.65°), 단일 약피크(29.12°, 이차상 확정 금지),
      제한된 측정 범위(20~58° 시편에서 >58° 반사는 out_of_range, 범위 내 불검출은 not_detected) 검증
    """
    resp = client.post(
        "/api/v1/comparison/analyze",
        json={"question_type": "process_variation"},
    )
    assert resp.status_code == 200
    data = resp.json()

    # 1) 700°C 시편에서 Brookite 단일 약피크(29.12°)는 이차상으로 확정되지 않아야 함
    slot_700 = next(s for s in data["slots"] if "700°C" in s["sample_name"])
    sec_evals_700 = slot_700["selected_xrd"]["secondary_phase_evaluations"]
    for sev in sec_evals_700:
        if "Brookite" in (sev.get("name") or ""):
            assert sev["verdict_code"] != "supported_multi_reflection"

    # 2) 미할당 피크(31.65° 근처)에는 (hkl)이 붙지 않아야 하며 marker_label == "?" 여야 함
    slot_850 = next(s for s in data["slots"] if "850°C" in s["sample_name"])
    peaks_850 = [p for p in data["all_peaks_table"] if p["slot_id"] == slot_850["slot_id"]]
    unassigned_peaks = [p for p in peaks_850 if p["marker_label"] == "?"]
    assert len(unassigned_peaks) >= 1
    for up in unassigned_peaks:
        assert up["assigned_hkl"] is None
        assert "미할당 피크" in up["assigned_phase"]

    # 3) 중첩 피크(54.32° / 54.58°)가 is_overlapping == True 로 표시되어야 함
    overlapping_peaks = [p for p in peaks_850 if p["is_overlapping"]]
    assert len(overlapping_peaks) >= 2

    # 4) 반사별 시편 비교표(reflection_evolution)에서 측정 범위 밖(out_of_range)과 미검출(not_detected) 구분 검증
    ref_table = data["reflection_evolution"]
    # 62.7° 반사: 850°C 시편(측정 범위 20~58°)에서는 out_of_range 여야 함
    row_62 = next((r for r in ref_table if abs(r["anchor_two_theta"] - 62.7) < 0.6), None)
    assert row_62 is not None
    cell_850_at_62 = next(c for c in row_62["per_specimen"] if c["slot_id"] == slot_850["slot_id"])
    assert cell_850_at_62["status"] == "out_of_range"

    # 27.45° Rutile (110) 반사: 500°C 시편(측정 범위 20~75°)에서는 범위 안에 있으나 검출되지 않았으므로 not_detected 여야 함
    slot_500 = next(s for s in data["slots"] if "500°C" in s["sample_name"])
    row_27 = next((r for r in ref_table if abs(r["anchor_two_theta"] - 27.45) < 0.6), None)
    assert row_27 is not None
    cell_500_at_27 = next(c for c in row_27["per_specimen"] if c["slot_id"] == slot_500["slot_id"])
    assert cell_500_at_27["status"] == "not_detected"


def test_5_sem_uncalibrated_scale_and_missing_sem_no_placeholder_violation(client: TestClient):
    """
    필수 사례 5:
    - 스케일바 미보정(TiO2-850C, scale_calibrated=False) 시편에서 입도 수치(µm/nm)를 허위 생성하지 않고 정성/보정 필요 상태 안내
    - SEM 이미지가 없는 시편(TiO2:Nb-5wt%, has_image=False)을 비교 열에 포함했을 때 다른 시편 이미지나 예시 이미지를 대체하지 않고
      has_image=False 및 status_message를 명시하는지 검증
    """
    # 1) 850°C 시편의 스케일 미보정 확인
    resp = client.post(
        "/api/v1/comparison/analyze",
        json={"question_type": "process_variation"},
    )
    assert resp.status_code == 200
    data = resp.json()
    slot_850 = next(s for s in data["slots"] if "850°C" in s["sample_name"])
    sem_850 = slot_850["selected_sem"]
    assert sem_850["has_image"] is True
    assert sem_850["scale_calibrated"] is False
    # 스케일 미보정 시 정량 입도(quant_metrics)는 None 이어야 함 (임의 µm 수치 생성 금지)
    assert sem_850["quant_metrics"] is None

    # 2) SEM 미보유 시편(TiO2:Nb-5wt%)을 슬롯에 추가하여 확인
    cand_amt = client.post(
        "/api/v1/comparison/candidates",
        json={"question_type": "dopant_amount", "auto_seed_if_empty": True},
    ).json()
    proj_5wt = next(
        c for c in cand_amt["eligible_candidates"] if "5wt%" in c["sample_name"]
    )
    resp_missing_sem = client.post(
        "/api/v1/comparison/analyze",
        json={
            "question_type": "dopant_amount",
            "slots": [{"project_id": proj_5wt["project_id"]}],
        },
    )
    assert resp_missing_sem.status_code == 200
    slot_5wt = resp_missing_sem.json()["slots"][0]
    sem_5wt = slot_5wt["selected_sem"]
    assert sem_5wt["has_image"] is False
    assert sem_5wt["raw_image_url"] is None
    assert "업로드된 SEM 이미지가 없습니다" in sem_5wt["status_message"]
    assert "대체하지 않음" in sem_5wt["status_message"]
