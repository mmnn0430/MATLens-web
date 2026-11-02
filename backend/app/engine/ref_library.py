"""Crystallographic Reference Pattern Library using pymatgen.

Features:
- Small, well-documented built-in reference library (32 common phases across oxides, metals, semiconductors,
  carbon/2D, minerals, and battery cathode materials) with explicit IDs, crystallographic literature/COD sources,
  space groups, lattice parameters, and pymatgen-calculated d-spacings / relative intensities.
- Dynamic parsing of user-uploaded CIF files (.cif) into reference patterns using pymatgen CifParser + XRDCalculator.
- Wavelength conversion via Bragg's law (2d sinθ = λ) so any X-ray source (Cu Kα, Co Kα, Mo Kα, Cr Kα, Fe Kα, synchrotron)
  is accurately handled.
"""
from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import numpy as np

from ..config import DATA_DIR, REF_LIBRARY_VERSION
from .mp_service import enrich_entry_with_mp_properties

REF_CACHE_PATH = DATA_DIR / "reference_library.json"
CIF_EXPORT_DIR = DATA_DIR / "cif"

XRAY_PRESETS: dict[str, float] = {
    "Cu Kα (1.5406 Å)": 1.5406,
    "Co Kα (1.7890 Å)": 1.7890,
    "Mo Kα (0.7107 Å)": 0.7107,
    "Cr Kα (2.2897 Å)": 2.2897,
    "Fe Kα (1.9360 Å)": 1.9360,
}


def _cubic(a: float) -> list[float]:
    return [a, a, a, 90.0, 90.0, 90.0]


def _tet(a: float, c: float) -> list[float]:
    return [a, a, c, 90.0, 90.0, 90.0]


def _hex(a: float, c: float) -> list[float]:
    return [a, a, c, 90.0, 90.0, 120.0]


# (ref_id, name, formula, spacegroup, lattice, sites, category, literature_source)
CURATED_STRUCTURES: list[tuple[str, str, str, str, list[float], list[tuple[str, list[float]]], str, str]] = [
    (
        "REF-TIO2-ANA",
        "Anatase (TiO2)",
        "TiO2",
        "I4_1/amd",
        _tet(3.7845, 9.5143),
        [("Ti", [0, 0.75, 0.125]), ("O", [0, 0.75, 0.3331])],
        "산화물/광촉매",
        "Horn et al., Z. Kristallogr. 136, 273 (1972); COD 9009086 기반 pymatgen 계산",
    ),
    (
        "REF-TIO2-RUT",
        "Rutile (TiO2)",
        "TiO2",
        "P4_2/mnm",
        _tet(4.5937, 2.9587),
        [("Ti", [0, 0, 0]), ("O", [0.3048, 0.3048, 0])],
        "산화물/광촉매",
        "Swope et al., Am. Mineral. 80, 448 (1995); COD 9004141 기반 pymatgen 계산",
    ),
    (
        "REF-SIO2-QTZ",
        "α-Quartz (SiO2)",
        "SiO2",
        "P3_221",
        _hex(4.9134, 5.4052),
        [("Si", [0.4697, 0, 2 / 3]), ("O", [0.4135, 0.2669, 0.7858])],
        "산화물/광물",
        "Levien et al., Am. Mineral. 65, 920 (1980); COD 9012600 기반 pymatgen 계산",
    ),
    (
        "REF-AL2O3-COR",
        "Corundum (α-Al2O3)",
        "Al2O3",
        "R-3c",
        _hex(4.7589, 12.991),
        [("Al", [0, 0, 0.3522]), ("O", [0.3064, 0, 0.25])],
        "산화물/세라믹",
        "Lewis et al., Acta Crystallogr. A38, 733 (1982); COD 9007496 기반 pymatgen 계산",
    ),
    (
        "REF-ZNO-WUR",
        "Zincite (ZnO, Wurtzite)",
        "ZnO",
        "P6_3mc",
        _hex(3.2498, 5.2066),
        [("Zn", [1 / 3, 2 / 3, 0]), ("O", [1 / 3, 2 / 3, 0.3820])],
        "산화물/반도체",
        "Albertsson et al., Acta Crystallogr. B45, 34 (1989); COD 9004178 기반 pymatgen 계산",
    ),
    (
        "REF-CEO2-FLU",
        "Ceria (CeO2)",
        "CeO2",
        "Fm-3m",
        _cubic(5.4113),
        [("Ce", [0, 0, 0]), ("O", [0.25, 0.25, 0.25])],
        "산화물/촉매",
        "Wyckoff Crystal Structures Vol. 1 (1963); COD 9009008 기반 pymatgen 계산",
    ),
    (
        "REF-ZRO2-CUB",
        "Cubic Zirconia (c-ZrO2)",
        "ZrO2",
        "Fm-3m",
        _cubic(5.128),
        [("Zr", [0, 0, 0]), ("O", [0.25, 0.25, 0.25])],
        "산화물/세라믹",
        "Martin et al., J. Appl. Crystallogr. 26, 683 (1993); COD 1528984 기반 pymatgen 계산",
    ),
    (
        "REF-ZRO2-MON",
        "Baddeleyite (m-ZrO2)",
        "ZrO2",
        "P2_1/c",
        [5.1505, 5.2116, 5.3173, 90.0, 99.23, 90.0],
        [("Zr", [0.2754, 0.0395, 0.2083]), ("O", [0.0700, 0.3317, 0.3447]), ("O", [0.4496, 0.7569, 0.4792])],
        "산화물/세라믹",
        "Howard et al., J. Am. Ceram. Soc. 71, 494 (1988); COD 9007485 기반 pymatgen 계산",
    ),
    (
        "REF-MGO-PER",
        "Periclase (MgO)",
        "MgO",
        "Fm-3m",
        _cubic(4.2117),
        [("Mg", [0, 0, 0]), ("O", [0.5, 0.5, 0.5])],
        "산화물/세라믹",
        "Sasaki et al., Proc. Jpn. Acad. 55B, 43 (1979); COD 9006789 기반 pymatgen 계산",
    ),
    (
        "REF-NIO-BUN",
        "Bunsenite (NiO)",
        "NiO",
        "Fm-3m",
        _cubic(4.1771),
        [("Ni", [0, 0, 0]), ("O", [0.5, 0.5, 0.5])],
        "산화물/촉매",
        "Sasaki et al., Proc. Jpn. Acad. 55B, 43 (1979); COD 9008693 기반 pymatgen 계산",
    ),
    (
        "REF-FE2O3-HEM",
        "Hematite (α-Fe2O3)",
        "Fe2O3",
        "R-3c",
        _hex(5.0355, 13.7471),
        [("Fe", [0, 0, 0.3553]), ("O", [0.3059, 0, 0.25])],
        "산화물/자성체",
        "Blake et al., Am. Mineral. 51, 123 (1966); COD 9015964 기반 pymatgen 계산",
    ),
    (
        "REF-FE3O4-MAG",
        "Magnetite (Fe3O4)",
        "Fe3O4",
        "Fd-3m:2",
        _cubic(8.3958),
        [("Fe", [0.125, 0.125, 0.125]), ("Fe", [0.5, 0.5, 0.5]), ("O", [0.2549, 0.2549, 0.2549])],
        "산화물/자성체",
        "Fleet, Acta Crystallogr. B37, 917 (1981); COD 9005812 기반 pymatgen 계산",
    ),
    (
        "REF-CO3O4-SPI",
        "Cobalt Oxide Spinel (Co3O4)",
        "Co3O4",
        "Fd-3m:2",
        _cubic(8.0837),
        [("Co", [0.125, 0.125, 0.125]), ("Co", [0.5, 0.5, 0.5]), ("O", [0.2632, 0.2632, 0.2632])],
        "산화물/배터리",
        "Picard et al., Acta Crystallogr. B36, 1545 (1980); COD 9005887 기반 pymatgen 계산",
    ),
    (
        "REF-SNO2-CAS",
        "Cassiterite (SnO2)",
        "SnO2",
        "P4_2/mnm",
        _tet(4.7374, 3.1864),
        [("Sn", [0, 0, 0]), ("O", [0.3071, 0.3071, 0])],
        "산화물/센서",
        "Baur & Khan, Acta Crystallogr. B27, 2133 (1971); COD 9007533 기반 pymatgen 계산",
    ),
    (
        "REF-CUO-TEN",
        "Tenorite (CuO)",
        "CuO",
        "C2/c",
        [4.6837, 3.4226, 5.1288, 90.0, 99.54, 90.0],
        [("Cu", [0.25, 0.25, 0]), ("O", [0, 0.4184, 0.25])],
        "산화물/촉매",
        "Asbrink & Norrby, Acta Crystallogr. B26, 8 (1970); COD 9015924 기반 pymatgen 계산",
    ),
    (
        "REF-CU2O-CUP",
        "Cuprite (Cu2O)",
        "Cu2O",
        "Pn-3m:1",
        _cubic(4.2696),
        [("O", [0, 0, 0]), ("Cu", [0.25, 0.25, 0.25])],
        "산화물/반도체",
        "Kirfel & Eichhorn, Acta Crystallogr. A46, 271 (1990); COD 9007497 기반 pymatgen 계산",
    ),
    (
        "REF-BATIO3-TET",
        "Barium Titanate (t-BaTiO3)",
        "BaTiO3",
        "P4mm",
        _tet(3.9945, 4.0335),
        [("Ba", [0, 0, 0]), ("Ti", [0.5, 0.5, 0.515]), ("O", [0.5, 0.5, -0.016]), ("O", [0.5, 0, 0.487])],
        "페로브스카이트",
        "Kwei et al., J. Phys. Chem. 97, 2368 (1993); COD 1507756 기반 pymatgen 계산",
    ),
    (
        "REF-SRTIO3-CUB",
        "Strontium Titanate (SrTiO3)",
        "SrTiO3",
        "Pm-3m",
        _cubic(3.9050),
        [("Sr", [0, 0, 0]), ("Ti", [0.5, 0.5, 0.5]), ("O", [0.5, 0.5, 0])],
        "페로브스카이트",
        "Abramov et al., Acta Crystallogr. B51, 942 (1995); COD 9002806 기반 pymatgen 계산",
    ),
    (
        "REF-SI-DIA",
        "Silicon (Si, NIST SRM 640 기준계)",
        "Si",
        "F-43m",
        _cubic(5.43119),
        [("Si", [0, 0, 0]), ("Si", [0.25, 0.25, 0.25])],
        "반도체/표준물질",
        "NIST SRM 640f 격자상수 a=5.43119 Å; diamond cubic pymatgen 계산",
    ),
    (
        "REF-SIC-3C",
        "3C-Silicon Carbide (β-SiC)",
        "SiC",
        "F-43m",
        _cubic(4.3596),
        [("Si", [0, 0, 0]), ("C", [0.25, 0.25, 0.25])],
        "반도체/세라믹",
        "Taylor & Jones, Silicon Carbide (1960); COD 1011031 기반 pymatgen 계산",
    ),
    (
        "REF-GAN-WUR",
        "Gallium Nitride (GaN)",
        "GaN",
        "P6_3mc",
        _hex(3.1891, 5.1855),
        [("Ga", [1 / 3, 2 / 3, 0]), ("N", [1 / 3, 2 / 3, 0.377])],
        "반도체",
        "Schulz & Thiemann, Solid State Commun. 23, 815 (1977); COD 9008868 기반 pymatgen 계산",
    ),
    (
        "REF-C-GRA",
        "Graphite (2H-C)",
        "C",
        "P6_3/mmc",
        _hex(2.464, 6.711),
        [("C", [0, 0, 0.25]), ("C", [1 / 3, 2 / 3, 0.25])],
        "탄소/2D",
        "Trucano & Chen, Nature 258, 136 (1975); COD 9011577 기반 pymatgen 계산",
    ),
    (
        "REF-MOS2-2H",
        "Molybdenum Disulfide (2H-MoS2)",
        "MoS2",
        "P6_3/mmc",
        _hex(3.161, 12.295),
        [("Mo", [1 / 3, 2 / 3, 0.25]), ("S", [1 / 3, 2 / 3, 0.621])],
        "탄소/2D",
        "Schonfeld et al., Acta Crystallogr. B39, 404 (1983); COD 9007660 기반 pymatgen 계산",
    ),
    (
        "REF-CU-FCC",
        "Copper (Cu, FCC)",
        "Cu",
        "Fm-3m",
        _cubic(3.6149),
        [("Cu", [0, 0, 0])],
        "금속",
        "Otte, J. Appl. Phys. 32, 1536 (1961); COD 9013014 기반 pymatgen 계산",
    ),
    (
        "REF-AL-FCC",
        "Aluminum (Al, FCC)",
        "Al",
        "Fm-3m",
        _cubic(4.0495),
        [("Al", [0, 0, 0])],
        "금속",
        "Witt, J. Appl. Phys. 38, 1560 (1967); COD 9008460 기반 pymatgen 계산",
    ),
    (
        "REF-NI-FCC",
        "Nickel (Ni, FCC)",
        "Ni",
        "Fm-3m",
        _cubic(3.5238),
        [("Ni", [0, 0, 0])],
        "금속",
        "Suh et al., J. Mater. Sci. 23, 757 (1988); COD 9008476 기반 pymatgen 계산",
    ),
    (
        "REF-AG-FCC",
        "Silver (Ag, FCC)",
        "Ag",
        "Fm-3m",
        _cubic(4.0862),
        [("Ag", [0, 0, 0])],
        "금속",
        "Spreadborough & Christian, J. Sci. Instrum. 36, 116 (1959); COD 9008459 기반 pymatgen 계산",
    ),
    (
        "REF-AU-FCC",
        "Gold (Au, FCC)",
        "Au",
        "Fm-3m",
        _cubic(4.0782),
        [("Au", [0, 0, 0])],
        "금속",
        "Suh et al., J. Mater. Sci. 23, 757 (1988); COD 9008463 기반 pymatgen 계산",
    ),
    (
        "REF-FE-BCC",
        "α-Iron (Ferrite, BCC)",
        "Fe",
        "Im-3m",
        _cubic(2.8665),
        [("Fe", [0, 0, 0])],
        "금속",
        "Basinski et al., Proc. R. Soc. A229, 459 (1955); COD 9008536 기반 pymatgen 계산",
    ),
    (
        "REF-CACO3-CAL",
        "Calcite (CaCO3)",
        "CaCO3",
        "R-3c",
        _hex(4.9896, 17.061),
        [("Ca", [0, 0, 0]), ("C", [0, 0, 0.25]), ("O", [0.2568, 0, 0.25])],
        "탄산염/광물",
        "Maslen et al., Acta Crystallogr. B49, 636 (1993); COD 9009667 기반 pymatgen 계산",
    ),
    (
        "REF-LICOO2-R3M",
        "Lithium Cobalt Oxide (LiCoO2)",
        "LiCoO2",
        "R-3m",
        _hex(2.8156, 14.054),
        [("Li", [0, 0, 0.5]), ("Co", [0, 0, 0]), ("O", [0, 0, 0.2396])],
        "배터리",
        "Akimoto et al., J. Solid State Chem. 141, 298 (1998); COD 1520810 기반 pymatgen 계산",
    ),
    (
        "REF-LIFEPO4-PNMA",
        "Olivine (LiFePO4)",
        "LiFePO4",
        "Pnma",
        [10.332, 6.010, 4.692, 90.0, 90.0, 90.0],
        [
            ("Li", [0, 0, 0]),
            ("Fe", [0.2822, 0.25, 0.9747]),
            ("P", [0.0950, 0.25, 0.4182]),
            ("O", [0.0968, 0.25, 0.7428]),
            ("O", [0.4571, 0.25, 0.2060]),
            ("O", [0.1656, 0.0465, 0.2848]),
        ],
        "배터리",
        "Streltsov et al., Kristallografiya 38, 69 (1993); COD 1101111 기반 pymatgen 계산",
    ),
    (
        "REF-NBFESB-HH",
        "Half-Heusler (NbFeSb)",
        "NbFeSb",
        "F-43m",
        _cubic(5.952),
        [("Nb", [0, 0, 0]), ("Sb", [0.5, 0.5, 0.5]), ("Fe", [0.25, 0.25, 0.25])],
        "열전소재/합금",
        "Joshi et al., Energy Environ. Sci. 7, 4070 (2014); MgAgAs-type F-43m (a=5.952 Å) pymatgen 계산",
    ),
    (
        "REF-FESB2-MAR",
        "Marcasite-type (FeSb2)",
        "FeSb2",
        "Pnnm",
        [5.8328, 6.5376, 3.1973, 90.0, 90.0, 90.0],
        [("Fe", [0, 0, 0]), ("Sb", [0.1885, 0.3561, 0])],
        "열전소재/금속간화합물",
        "Holseth & Kjekshus, Acta Chem. Scand. 23, 3043 (1969); COD 9008926 기반 pymatgen 계산",
    ),
    (
        "REF-FESB-NIC",
        "Nickeline-type (FeSb)",
        "FeSb",
        "P6_3/mmc",
        _hex(4.066, 5.130),
        [("Fe", [0, 0, 0]), ("Sb", [1 / 3, 2 / 3, 0.25])],
        "열전소재/금속간화합물",
        "Kjekshus & Walseth, Acta Chem. Scand. 23, 2621 (1969); NiAs-type P6_3/mmc pymatgen 계산",
    ),
    (
        "REF-SB-R3M",
        "Antimony (Sb, Rhombohedral)",
        "Sb",
        "R-3m",
        _hex(4.3084, 11.274),
        [("Sb", [0, 0, 0.2335])],
        "금속/반금속",
        "Barrett et al., Acta Crystallogr. 16, 451 (1963); COD 9008575 기반 pymatgen 계산",
    ),
    (
        "REF-NB-BCC",
        "Niobium (Nb, BCC)",
        "Nb",
        "Im-3m",
        _cubic(3.3004),
        [("Nb", [0, 0, 0])],
        "금속",
        "Straumanis & Zyszczynski, J. Appl. Crystallogr. 3, 1 (1970); COD 9008545 기반 pymatgen 계산",
    ),
    (
        "REF-NB3SB-A15",
        "A15-type (Nb3Sb)",
        "Nb3Sb",
        "Pm-3n",
        _cubic(5.262),
        [("Sb", [0, 0, 0]), ("Nb", [0.25, 0, 0.5])],
        "열전소재/금속간화합물",
        "Furuseth & Kjekshus, Acta Chem. Scand. 18, 1180 (1964); Cr3Si-type Pm-3n pymatgen 계산",
    ),
    (
        "REF-NBSB2-C2M",
        "Niobium Diantimonide (NbSb2)",
        "NbSb2",
        "C2/m",
        [10.239, 3.6319, 8.333, 90.0, 120.07, 90.0],
        [("Nb", [0.344, 0, 0.304]), ("Sb", [0.156, 0, 0.097]), ("Sb", [0.405, 0, 0.640])],
        "열전소재/금속간화합물",
        "Furuseth & Kjekshus, Acta Crystallogr. 18, 320 (1965); OsGe2-type C2/m pymatgen 계산",
    ),
]


def build_reference_library(export_cifs: bool = False) -> dict[str, Any]:
    """Generate the curated reference library JSON using pymatgen XRDCalculator."""
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    from pymatgen.core import Lattice, Structure
    from pymatgen.io.cif import CifWriter

    calc = XRDCalculator(wavelength=1.5406)
    entries: list[dict[str, Any]] = []
    if export_cifs:
        CIF_EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    for ref_id, name, formula, sg, latt, sites, cat, source in CURATED_STRUCTURES:
        lattice = Lattice.from_parameters(*latt)
        species = [sp for sp, _ in sites]
        coords = [co for _, co in sites]
        struct = Structure.from_spacegroup(sg, lattice, species, coords, tol=1e-3)
        pat = calc.get_pattern(struct, scaled=True, two_theta_range=(5.0, 120.0))
        hkls = [
            ", ".join("(" + "".join(str(i) for i in h["hkl"]) + ")" for h in fam)
            for fam in pat.hkls
        ]
        entry_dict = {
            "id": ref_id,
            "name": name,
            "formula": formula,
            "spacegroup": sg.split(":")[0],
            "category": cat,
            "source": source,
            "is_user_cif": False,
            "calc_wavelength_A": 1.5406,
            "calc_two_theta_range": [5.0, 120.0],
            "lattice": latt,
            "elements": sorted({str(e) for e in struct.composition.elements}),
            "density_g_cm3": round(float(struct.density), 3),
            "two_theta_cu": [round(float(v), 4) for v in pat.x],
            "intensity": [round(float(v), 2) for v in pat.y],
            "d_A": [round(float(v), 5) for v in pat.d_hkls],
            "hkl": hkls,
        }
        entries.append(enrich_entry_with_mp_properties(entry_dict))
        if export_cifs and ref_id in {"REF-TIO2-ANA", "REF-TIO2-RUT", "REF-SI-DIA", "REF-ZNO-WUR"}:
            CifWriter(struct).write_file(str(CIF_EXPORT_DIR / f"{ref_id}.cif"))

    payload = {
        "library_version": REF_LIBRARY_VERSION,
        "count": len(entries),
        "description": "출판된 결정구조(Wyckoff/COD 대표 격자상수·원자좌표)로부터 pymatgen XRDCalculator로 계산한 소규모 기준 패턴 라이브러리",
        "entries": entries,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    REF_CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def load_reference_library() -> dict[str, Any]:
    if REF_CACHE_PATH.exists():
        data = json.loads(REF_CACHE_PATH.read_text(encoding="utf-8"))
        if data.get("library_version") == REF_LIBRARY_VERSION and data.get("entries"):
            data["entries"] = [enrich_entry_with_mp_properties(e) for e in data["entries"]]
            return data
    return build_reference_library(export_cifs=True)


def parse_user_cif(raw_bytes: bytes, filename: str, ref_index: int = 1) -> dict[str, Any]:
    """Parse a user-uploaded CIF file with pymatgen and compute its d-spacings and intensities."""
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    from pymatgen.io.cif import CifParser

    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if not text or "loop_" not in text and "_cell_length_a" not in text:
        raise ValueError("유효한 CIF 결정구조 형식이 아닙니다 (_cell_length_a 항목 누락).")

    parser = CifParser.from_str(text)
    structures = parser.parse_structures(primitive=False)
    if not structures:
        raise ValueError("CIF 파일에서 결정구조를 읽지 못했습니다.")
    struct = structures[0]
    calc = XRDCalculator(wavelength=1.5406)
    pat = calc.get_pattern(struct, scaled=True, two_theta_range=(5.0, 120.0))
    hkls = [
        ", ".join("(" + "".join(str(i) for i in h["hkl"]) + ")" for h in fam)
        for fam in pat.hkls
    ]
    formula = struct.composition.reduced_formula
    try:
        sg_symbol, _ = struct.get_space_group_info()
    except Exception:
        sg_symbol = "P1"

    stem = Path(filename).stem
    return enrich_entry_with_mp_properties(
        {
            "id": f"USER-CIF-{ref_index:02d}",
            "name": f"{stem} ({formula}, 사용자 CIF)",
            "formula": formula,
            "spacegroup": sg_symbol,
            "category": "사용자 업로드 CIF",
            "source": f"사용자 업로드 CIF 파일 ({filename}) → pymatgen 실시간 계산",
            "is_user_cif": True,
            "calc_wavelength_A": 1.5406,
            "calc_two_theta_range": [5.0, 120.0],
            "lattice": [round(float(v), 4) for v in struct.lattice.parameters],
            "elements": sorted({str(e) for e in struct.composition.elements}),
            "density_g_cm3": round(float(struct.density), 3),
            "two_theta_cu": [round(float(v), 4) for v in pat.x],
            "intensity": [round(float(v), 2) for v in pat.y],
            "d_A": [round(float(v), 5) for v in pat.d_hkls],
            "hkl": hkls,
        }
    )


def project_pattern_to_wavelength(entry: dict[str, Any], wavelength_A: float) -> tuple[np.ndarray, np.ndarray, list[str], np.ndarray]:
    """Convert reference d-spacings to 2θ angles at the requested X-ray wavelength."""
    d_arr = np.asarray(entry["d_A"], dtype=float)
    i_arr = np.asarray(entry["intensity"], dtype=float)
    hkls = list(entry.get("hkl", [""] * len(d_arr)))
    sin_th = wavelength_A / (2.0 * np.maximum(d_arr, 1e-8))
    valid = (sin_th > 0.0) & (sin_th < 0.9999)
    two_theta = np.degrees(2.0 * np.arcsin(sin_th[valid]))
    valid_idx = np.where(valid)[0]
    return two_theta, i_arr[valid], [hkls[i] for i in valid_idx], d_arr[valid]
