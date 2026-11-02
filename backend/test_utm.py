import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r"c:\Users\tempo\Desktop\ai enabled 해커톤 자료\matlens-web\backend")
from app.core.utm_engine import parse_utm_raw_text, analyze_utm_dataset, KGF_MM2_TO_MPA
from app.core.utm_pdf import generate_utm_charts_image, generate_utm_pdf_report
import numpy as np

print("--- 1. Testing UTM Raw Parser & Numerical Calculations with abs100-3.txt Specs ---")

lines = []
lines.append("일련번호\t시간\t하중\t변위\t응력\t변형율\t진응력\t진변형율")
lines.append("\tsec\tkgf\tmm\tkgf/mm²\t%\tkgf/mm²\t%")

for serial in range(1, 1099):
    t = round(serial * (1.310 / 326.0), 3)
    if serial == 326:
        stress = 2.746
        strain = 0.83
        load = 96.11
    elif serial >= 1066:
        # Negative load rows 1066 to 1098 (33 rows)
        load = -0.15 - (serial - 1066) * 0.05
        stress = -0.004
        strain = 3.52
    else:
        frac = serial / 326.0 if serial < 326 else max(0.05, 1.0 - (serial - 326.0) / 750.0)
        stress = round(max(0.01, 2.746 * frac * 0.98), 4)
        strain = round(frac * 0.83 * 0.98, 4)
        load = round(stress * 35.0, 3)

    disp = round(strain * 0.5, 4)
    true_stress = round(stress * 1.008, 4)
    true_strain = round(strain * 0.995, 4)
    lines.append(f"{serial}\t{t}\t{load}\t{disp}\t{stress}\t{strain}\t{true_stress}\t{true_strain}")

raw_text = "\n".join(lines)

# 1. Parsing
parsed = parse_utm_raw_text(raw_text)
assert parsed["row_count"] == 1098, f"Row count expected 1098, got {parsed['row_count']}"
assert len(parsed["headers"]) == 8, f"Headers count expected 8, got {len(parsed['headers'])}"
print(f"✓ Parsed 8 columns and {parsed['row_count']} rows successfully.")

# 2. Numerical Analysis
res = analyze_utm_dataset(parsed)
p_stress = res["peak_stress"]
assert p_stress["serial_number"] == 326, f"Expected peak serial 326, got {p_stress['serial_number']}"
assert p_stress["stress_raw"] == 2.746, f"Expected peak stress 2.746, got {p_stress['stress_raw']}"
expected_mpa = 2.746 * KGF_MM2_TO_MPA
assert abs(p_stress["stress_MPa"] - expected_mpa) < 1e-4, f"Expected MPa {expected_mpa}, got {p_stress['stress_MPa']}"
assert p_stress["strain_pct"] == 0.83, f"Expected strain 0.83%, got {p_stress['strain_pct']}"
assert p_stress["time_sec"] == 1.310, f"Expected time 1.310s, got {p_stress['time_sec']}"
print(f"✓ Peak stress verified: {p_stress['stress_raw']} kgf/mm² -> {p_stress['stress_MPa']} MPa at Serial No. {p_stress['serial_number']} (Time {p_stress['time_sec']}s, Strain {p_stress['strain_pct']}%)")

# 3. Negative load verification
neg = res["negative_load_summary"]
assert neg["count"] == 33, f"Expected 33 negative load rows, got {neg['count']}"
assert neg["first_serial"] == 1066, f"Expected first negative serial 1066, got {neg['first_serial']}"
assert neg["last_serial"] == 1098, f"Expected last negative serial 1098, got {neg['last_serial']}"
print(f"✓ Detected {neg['count']} negative load rows (No. {neg['first_serial']} ~ {neg['last_serial']}) correctly.")

# 4. Range slicing verification
sliced_res = analyze_utm_dataset(parsed, start_index=0, end_index=500)
assert sliced_res["analysis_range"]["count"] == 500
assert sliced_res["negative_load_summary"]["count"] == 0  # no negatives in first 500 rows
print(f"✓ Analysis range slicing verified: 500 rows, 0 negative loads in slice.")

# 5. Synthetic Elastic Modulus Verification (Known Slope)
# True E = 70 GPa (e.g. Aluminum) = 70,000 MPa
# Stress (MPa) = 70,000 * (Strain% / 100) = 700 * Strain%
synth_lines = ["일련번호\t변형률\t응력", "\t%\tMPa"]
for i in range(1, 41):
    st_pct = i * 0.01  # 0.01% to 0.40%
    st_mpa = 700.0 * st_pct
    synth_lines.append(f"{i}\t{st_pct:.4f}\t{st_mpa:.4f}")

synth_parsed = parse_utm_raw_text("\n".join(synth_lines))
synth_res = analyze_utm_dataset(synth_parsed, elastic_start_strain_pct=0.05, elastic_end_strain_pct=0.30)
E_calc = synth_res["elastic_modulus"]["E_GPa"]
assert abs(E_calc - 70.0) < 0.05, f"Expected E=70.0 GPa, got {E_calc}"
print(f"✓ Synthetic Elastic Modulus verification passed: Target 70.0 GPa, Calculated {E_calc} GPa (R² = {synth_res['elastic_modulus']['r_squared']})")

# 6. Chart & PDF Report Generation Test
chart_bytes = generate_utm_charts_image(res, title="Test Specimen")
assert len(chart_bytes) > 1000, "Chart image generation failed"
pdf_bytes = generate_utm_pdf_report(res, file_name="abs100-3.txt", analysis_name="ABS 100 Tensile Test")
assert len(pdf_bytes) > 2000, "PDF report generation failed"
print(f"✓ Standalone UTM Chart PNG ({len(chart_bytes)} bytes) and PDF ({len(pdf_bytes)} bytes) generated successfully.")

print("\n>>> ALL UTM UNIT & NUMERICAL TESTS PASSED! <<<")
