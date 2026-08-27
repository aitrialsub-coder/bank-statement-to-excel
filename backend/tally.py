"""TallyPrime / Tally ERP 9 XML gateway client."""

from __future__ import annotations

from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

import httpx

DEFAULT_TIMEOUT = 15.0


class TallyError(Exception):
    pass


def _strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def envelope_export(report_id: str, extra_body: str = "") -> str:
    return f"""<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>{escape(report_id)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        {extra_body}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def envelope_import(xml_inner: str) -> str:
    return f"""<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVIMPORTDUPLICATES>No</SVIMPORTDUPLICATES>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      {xml_inner}
    </DATA>
  </BODY>
</ENVELOPE>
"""


async def post_xml(base_url: str, xml: str) -> str:
    url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(
                url,
                content=xml.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
            )
            resp.raise_for_status()
            return resp.text
    except httpx.HTTPError as exc:
        raise TallyError(
            f"Could not reach Tally at {url}. Open TallyPrime, enable gateway "
            f"(F12 → Advanced Configuration → TallyPrime is acting as) and allow port 9000. {exc}"
        ) from exc


def parse_companies(xml_text: str) -> list[str]:
    names: list[str] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        # Tally sometimes returns a simple list
        for line in xml_text.splitlines():
            line = line.strip()
            if line and not line.startswith("<"):
                names.append(line)
        return names
    for el in root.iter():
        tag = _strip_ns(el.tag).upper()
        if tag in {"COMPANYNAME", "NAME", "COMPANY"} and _text(el):
            val = _text(el)
            if val not in names and val.lower() not in {"yes", "no"}:
                names.append(val)
    return names


def parse_ledgers(xml_text: str) -> list[dict]:
    ledgers: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ledgers
    for el in root.iter():
        tag = _strip_ns(el.tag).upper()
        if tag == "LEDGER":
            name = el.attrib.get("NAME") or _text(el.find("NAME")) or _text(el.find("name"))
            parent = ""
            for child in el:
                if _strip_ns(child.tag).upper() in {"PARENT", "LEDGERPARENT"}:
                    parent = _text(child)
            if name:
                ledgers.append({"name": name, "parent": parent})
    if not ledgers:
        for el in root.iter():
            if _strip_ns(el.tag).upper() == "NAME" and _text(el):
                ledgers.append({"name": _text(el), "parent": ""})
    # unique
    seen = set()
    out = []
    for lg in ledgers:
        if lg["name"] not in seen:
            seen.add(lg["name"])
            out.append(lg)
    return out


def parse_import_result(xml_text: str) -> dict:
    created = modified = exceptions = 0
    last_error = ""
    try:
        root = ET.fromstring(xml_text)
        for el in root.iter():
            tag = _strip_ns(el.tag).upper()
            t = _text(el)
            if tag == "CREATED":
                created = int(t or 0)
            elif tag == "ALTERED":
                modified = int(t or 0)
            elif tag == "EXCEPTIONS":
                exceptions = int(t or 0)
            elif tag in {"LINEERROR", "ERROR"} and t:
                last_error = t
    except ET.ParseError:
        last_error = xml_text[:400]
    ok = exceptions == 0 and (created + modified) > 0
    return {
        "ok": ok or (created + modified + exceptions == 0 and not last_error),
        "created": created,
        "altered": modified,
        "exceptions": exceptions,
        "message": last_error or xml_text[:300],
        "raw": xml_text[:2000],
    }


def voucher_xml(
    *,
    date_yyyymmdd: str,
    vch_type: str,
    narration: str,
    amount: float,
    bank_ledger: str,
    party_ledger: str,
    is_receipt: bool,
) -> str:
    amt = f"{abs(amount):.2f}"
    bank_is_dr = not is_receipt  # payment: bank credit? In Tally Payment: Bank Cr, Party Dr
    # Receipt: Bank Dr, Party Cr
    # Payment: Party Dr, Bank Cr
    if is_receipt:
        first_ledger, first_dr = bank_ledger, "Yes"
        second_ledger, second_dr = party_ledger, "No"
    else:
        first_ledger, first_dr = party_ledger, "Yes"
        second_ledger, second_dr = bank_ledger, "No"

    def ledger_entry(name: str, is_deemed_pos: str) -> str:
        return f"""
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>{escape(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>{is_deemed_pos}</ISDEEMEDPOSITIVE>
          <AMOUNT>{"-" if is_deemed_pos == "Yes" else ""}{amt}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>"""

    return f"""
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="{escape(vch_type)}" ACTION="Create">
          <DATE>{date_yyyymmdd}</DATE>
          <VOUCHERTYPENAME>{escape(vch_type)}</VOUCHERTYPENAME>
          <NARRATION>{escape(narration[:250])}</NARRATION>
          <EFFECTIVEDATE>{date_yyyymmdd}</EFFECTIVEDATE>
          {ledger_entry(first_ledger, first_dr)}
          {ledger_entry(second_ledger, second_dr)}
        </VOUCHER>
      </TALLYMESSAGE>
    """
