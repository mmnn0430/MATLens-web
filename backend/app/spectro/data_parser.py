"""Generic raw data parser for FT-IR, DSC, and TGA text/CSV/TSV/XLSX files.

Provides:
- Encoding auto-detection (UTF-8, CP949, EUC-KR, Latin-1)
- Header/preamble detection and metadata separation
- Delimiter auto-detection (comma, tab, semicolon, space/whitespace)
- Pure-Python XLSX zip/xml extraction
- Column role and unit inference with user override support
- Data validation, missing value / NaN tracking, and raw row count preservation
"""
from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

_NUM_RE = re.compile(r"^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$")


def detect_encoding(raw_bytes: bytes) -> str:
    """Detect text encoding among common Korean/scientific formats."""
    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    for enc in ("utf-8", "cp949", "euc-kr", "latin-1"):
        try:
            raw_bytes.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def extract_xlsx_rows(raw_bytes: bytes) -> list[list[str]]:
    """Extract rows from first worksheet of .xlsx file without external dependencies."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            names = zf.namelist()
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in names:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in ss_root:
                    shared_strings.append("".join((t.text or "") for t in si.iter() if t.tag.endswith("t")))

            sheet_candidates = sorted(
                n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")
            )
            if not sheet_candidates:
                raise ValueError("Excel(.xlsx) 파일 내부에 워크시트가 없습니다.")

            sheet_root = ET.fromstring(zf.read(sheet_candidates[0]))
            rows: list[list[str]] = []
            for r in sheet_root.iter():
                if not r.tag.endswith("row"):
                    continue
                row_dict: dict[int, str] = {}
                for c in r:
                    ref = c.attrib.get("r", "")
                    col_letters = "".join(ch for ch in ref if ch.isalpha())
                    if col_letters:
                        col_idx = 0
                        for ch in col_letters:
                            col_idx = col_idx * 26 + (ord(ch.upper()) - ord("A") + 1)
                        col_idx -= 1
                    else:
                        col_idx = len(row_dict)
                    cell_type = c.attrib.get("t", "")
                    v_el = next((ch for ch in c if ch.tag.endswith("v")), None)
                    is_el = next((ch for ch in c if ch.tag.endswith("is")), None)
                    if v_el is not None and v_el.text is not None:
                        val = v_el.text.strip()
                        if cell_type == "s" and val.isdigit() and int(val) < len(shared_strings):
                            val = shared_strings[int(val)].strip()
                    elif is_el is not None:
                        val = "".join((t.text or "") for t in is_el.iter() if t.tag.endswith("t")).strip()
                    else:
                        val = ""
                    row_dict[col_idx] = val
                if row_dict:
                    max_c = max(row_dict.keys())
                    rows.append([row_dict.get(i, "").strip() for i in range(max_c + 1)])
            return rows
    except zipfile.BadZipFile as exc:
        raise ValueError("손상되었거나 유효하지 않은 Excel(.xlsx) 파일입니다.") from exc


def parse_raw_tabular_text(text: str) -> tuple[list[str], list[list[str]], dict[str, str], list[str]]:
    """Parse raw text with metadata preamble into (headers, rows, metadata_dict, warnings)."""
    raw_lines = [ln.strip() for ln in text.splitlines()]
    non_empty = [ln for ln in raw_lines if ln]
    if not non_empty:
        raise ValueError("파일에 읽을 수 있는 데이터가 없습니다.")

    metadata: dict[str, str] = {}
    warnings: list[str] = []

    # Detect delimiter on sample data lines
    def is_data_line(ln: str) -> bool:
        tokens = re.split(r"[\t,;\s]+", ln.strip())
        nums = [t for t in tokens if _NUM_RE.match(t)]
        return len(nums) >= 2

    # Collect preamble metadata (e.g. key: value lines or lines starting with #, %, //)
    data_start_idx = 0
    candidate_header_idx = -1

    for idx, ln in enumerate(non_empty):
        if is_data_line(ln):
            data_start_idx = idx
            break
        # Check key-value preamble
        if ":" in ln or "=" in ln:
            sep = ":" if ":" in ln else "="
            k, v = ln.split(sep, 1)
            clean_k = k.strip().lstrip("#/% ")
            clean_v = v.strip()
            if clean_k and clean_v:
                metadata[clean_k] = clean_v
        else:
            # Maybe this is the column header line
            candidate_header_idx = idx

    if candidate_header_idx >= 0 and candidate_header_idx == data_start_idx - 1:
        header_line = non_empty[candidate_header_idx]
    elif data_start_idx > 0 and not candidate_header_idx >= 0:
        header_line = non_empty[data_start_idx - 1]
    else:
        header_line = ""

    # Delimiter detection
    sample_lines = non_empty[data_start_idx : data_start_idx + 15]
    counts = {",": 0, "\t": 0, ";": 0}
    for sl in sample_lines:
        for d in counts:
            counts[d] += sl.count(d)
    best_delim = max(counts, key=counts.get)
    if counts[best_delim] < len(sample_lines):
        # Space or arbitrary whitespace delimiter
        best_delim = r"\s+"

    # Split rows
    parsed_rows: list[list[str]] = []
    for ln in non_empty[data_start_idx:]:
        if best_delim == r"\s+":
            cols = [c.strip() for c in re.split(r"\s+", ln.strip()) if c.strip()]
        else:
            cols = [c.strip() for c in ln.split(best_delim)]
        if cols:
            parsed_rows.append(cols)

    # Determine headers
    headers: list[str] = []
    if header_line:
        clean_hl = header_line.lstrip("#/% ").strip()
        if best_delim == r"\s+":
            headers = [h.strip() for h in re.split(r"\s+", clean_hl) if h.strip()]
        else:
            headers = [h.strip() for h in clean_hl.split(best_delim)]

    # Validate header length matching data column count
    if parsed_rows:
        col_count = len(parsed_rows[0])
        if len(headers) != col_count:
            if len(headers) > col_count:
                headers = headers[:col_count]
            else:
                for i in range(len(headers), col_count):
                    headers.append(f"열 {i+1}")

    return headers, parsed_rows, metadata, warnings


def parse_raw_file_bytes(raw_bytes: bytes, filename: str) -> dict[str, Any]:
    """Top-level parser supporting CSV, TXT, TSV, and XLSX."""
    is_xlsx = raw_bytes[:4] == b"PK\x03\x04" or filename.lower().endswith((".xlsx", ".xlsm"))
    metadata: dict[str, str] = {}
    warnings: list[str] = []

    if is_xlsx:
        encoding = "xlsx"
        try:
            raw_rows = extract_xlsx_rows(raw_bytes)
        except Exception as e:
            raise ValueError(f"XLSX 파싱 실패: {e}") from e

        if not raw_rows:
            raise ValueError("Excel 시트에 데이터가 비어 있습니다.")

        # Find header and data rows
        data_start_idx = 0
        for i, row in enumerate(raw_rows):
            nums = [c for c in row if _NUM_RE.match(c)]
            if len(nums) >= 2:
                data_start_idx = i
                break

        if data_start_idx > 0:
            headers = raw_rows[data_start_idx - 1]
        else:
            headers = [f"열 {i+1}" for i in range(len(raw_rows[0]))]

        rows = raw_rows[data_start_idx:]
    else:
        encoding = detect_encoding(raw_bytes)
        try:
            text = raw_bytes.decode(encoding)
        except Exception:
            text = raw_bytes.decode("latin-1", errors="replace")
            warnings.append(f"지정된 인코딩({encoding}) 디코딩에 실패하여 안전한 대체 인코딩으로 변환했습니다.")
        headers, rows, metadata, text_warnings = parse_raw_tabular_text(text)
        warnings.extend(text_warnings)

    if not rows:
        raise ValueError("파싱된 수치 데이터 행이 존재하지 않습니다.")

    num_cols = len(rows[0])
    # Build column arrays and statistics
    col_data: list[list[float | None]] = [[] for _ in range(num_cols)]
    non_numeric_counts = [0] * num_cols
    total_raw_rows = len(rows)

    for r_idx, row in enumerate(rows):
        for c_idx in range(num_cols):
            val_str = row[c_idx] if c_idx < len(row) else ""
            if _NUM_RE.match(val_str):
                try:
                    col_data[c_idx].append(float(val_str))
                except ValueError:
                    col_data[c_idx].append(None)
                    non_numeric_counts[c_idx] += 1
            else:
                col_data[c_idx].append(None)
                non_numeric_counts[c_idx] += 1

    # Infer column roles
    columns_info: list[dict[str, Any]] = []
    for c_idx, h_name in enumerate(headers):
        preview_vals = [v for v in col_data[c_idx][:8] if v is not None]
        valid_count = sum(1 for v in col_data[c_idx] if v is not None)
        inferred_role, inferred_unit = infer_column_role_and_unit(h_name, preview_vals)
        columns_info.append({
            "index": c_idx,
            "name": h_name,
            "detected_role": inferred_role,
            "detected_unit": inferred_unit,
            "preview": preview_vals[:5],
            "valid_count": valid_count,
            "missing_or_nan_count": total_raw_rows - valid_count,
        })

    return {
        "filename": filename,
        "encoding": encoding,
        "metadata": metadata,
        "headers": headers,
        "columns": columns_info,
        "raw_row_count": total_raw_rows,
        "rows_preview": rows[:10],
        "column_data": col_data,
        "warnings": warnings,
    }


def infer_column_role_and_unit(name: str, preview_values: list[float]) -> tuple[str, str]:
    """Heuristic identification of column role and unit across spectroscopy and thermal domains."""
    nl = name.lower().strip()

    # FT-IR: Wavenumber
    if any(k in nl for k in ("wavenumber", "wave_number", "cm-1", "cm^-1", "1/cm", "파수")):
        return "wavenumber", "cm⁻¹"
    # FT-IR: Transmittance
    if any(k in nl for k in ("%t", "% t", "transmittance", "trans", "투과율")):
        return "transmittance", "%T"
    # FT-IR: Absorbance
    if any(k in nl for k in ("absorbance", "abs", "a.u.", "흡광도")):
        return "absorbance", "A"

    # DSC / TGA: Temperature
    if any(k in nl for k in ("temp", "temperature", "온도", "°c", "deg c", "kelvin", "k")):
        if "k" in nl and "°c" not in nl and "c" not in nl:
            return "temperature", "K"
        return "temperature", "°C"
    # Time
    if any(k in nl for k in ("time", "시간", "sec", "min", "초", "분")):
        if "min" in nl or "분" in nl:
            return "time", "min"
        return "time", "s"

    # DSC: Heat Flow
    if any(k in nl for k in ("heat flow", "heatflow", "hf", "열유속", "열류")):
        if "w/g" in nl or "w / g" in nl:
            return "heat_flow", "W/g"
        if "mw/mg" in nl:
            return "heat_flow", "mW/mg"
        if "mw" in nl:
            return "heat_flow", "mW"
        if "w" in nl:
            return "heat_flow", "W"
        return "heat_flow", "mW"

    # DSC: Heat Capacity
    if any(k in nl for k in ("cp", "heat capacity", "specific heat", "비열")):
        if "j/(g" in nl or "j/g" in nl:
            return "heat_capacity", "J/(g·K)"
        return "heat_capacity", "mJ/K"

    # TGA: Weight / Mass
    if any(k in nl for k in ("weight %", "weight(%)", "wt%", "wt %", "mass %", "mass(%)", "잔존율", "질량%")):
        return "mass_percent", "%"
    if any(k in nl for k in ("weight", "mass", "질량", "무게", "mg", "g")):
        if "mg" in nl:
            return "mass", "mg"
        if "g" in nl:
            return "mass", "g"
        return "mass", "mg"

    # TGA: DTG
    if any(k in nl for k in ("dtg", "deriv", "derivative", "dw/dt", "미분")):
        if "%/min" in nl:
            return "dtg", "%/min"
        return "dtg", "%/°C"

    # Fallback numerical inspection
    if preview_values:
        first_val = preview_values[0]
        # Wavenumber typically 400 ~ 4000 cm-1
        if 400.0 <= first_val <= 4500.0 and len(preview_values) >= 2 and preview_values[0] > preview_values[1]:
            return "wavenumber", "cm⁻¹"
        # Transmittance 0 ~ 110%
        if all(0.0 <= v <= 120.0 for v in preview_values):
            return "transmittance", "%T"
        # Temperature 20 ~ 1000 °C
        if 15.0 <= first_val <= 1200.0 and len(preview_values) >= 2 and preview_values[1] >= preview_values[0]:
            return "temperature", "°C"

    return "unknown", ""
