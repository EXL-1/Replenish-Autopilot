"""Seed a consumable, emit a ReorderSignal, compare three shops on Tavily."""

import csv
import json
import os
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "seed"
OUTPUT = ROOT / "output"
THRESHOLD_DAYS = 7
PRICE_RE = re.compile(r"£\s*(\d+(?:\.\d{1,2})?)")


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def reorder_signal(row: dict[str, str], today: date) -> dict | None:
    last_delivery = date.fromisoformat(row["last_delivery"])
    cadence_days = int(row["cadence_days"])
    est_empty = last_delivery + timedelta(days=cadence_days)
    days_until_empty = (est_empty - today).days
    if days_until_empty >= THRESHOLD_DAYS:
        return None
    return {
        "consumable_id": row["consumable_id"],
        "product_key": row["product_key"],
        "est_empty_date": est_empty.isoformat(),
        "days_until_empty": days_until_empty,
        "source": row["source"],
    }


def parse_price(text: str) -> float | None:
    match = PRICE_RE.search(text)
    if not match:
        return None
    return float(match.group(1))


def looks_in_stock(text: str, price: float | None) -> bool:
    lowered = text.lower()
    if "out of stock" in lowered or "sold out" in lowered or "unavailable" in lowered:
        return False
    return price is not None


def tavily_search(api_key: str, query: str, domain: str) -> dict:
    body = json.dumps(
        {
            "query": query,
            "search_depth": "basic",
            "max_results": 5,
            "include_domains": [domain],
        }
    ).encode()
    request = urllib.request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def compare_shop(api_key: str, signal: dict, shop: dict[str, str]) -> dict:
    query = signal["product_key"].replace("-", " ")
    payload = tavily_search(api_key, query, shop["domain"])
    results = payload.get("results") or []
    best_price = None
    evidence_url = None
    evidence_text = ""
    for result in results:
        text = f"{result.get('title', '')} {result.get('content', '')}"
        price = parse_price(text)
        if price is None:
            continue
        if best_price is None or price < best_price:
            best_price = price
            evidence_url = result.get("url")
            evidence_text = text
    return {
        "consumable_id": signal["consumable_id"],
        "shop_id": shop["shop_id"],
        "shop_name": shop["name"],
        "price": best_price,
        "currency": "GBP",
        "in_stock": looks_in_stock(evidence_text, best_price),
        "found_at": datetime.now(timezone.utc).isoformat(),
        "evidence_url": evidence_url,
    }


def choose(findings: list[dict]) -> dict | None:
    priced = [row for row in findings if row["in_stock"] and row["price"] is not None]
    if not priced:
        return None
    return min(priced, key=lambda row: row["price"])


def main() -> None:
    load_dotenv(ROOT / ".env")
    today = date.today()
    signals = []
    for row in read_csv(SEED / "consumables.csv"):
        signal = reorder_signal(row, today)
        if signal:
            signals.append(signal)
    if not signals:
        raise SystemExit(f"No consumable is under {THRESHOLD_DAYS} days.")

    signal = signals[0]
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / "reorder_signal.json").write_text(json.dumps(signal, indent=2) + "\n")
    print("ReorderSignal")
    print(json.dumps(signal, indent=2))

    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        raise SystemExit("Signal written. Set TAVILY_API_KEY in .env to compare shops.")

    findings = []
    for shop in read_csv(SEED / "shops.csv"):
        try:
            findings.append(compare_shop(api_key, signal, shop))
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise SystemExit(f"Tavily failed for {shop['name']}: {error.code} {detail}") from error

    winner = choose(findings)
    (OUTPUT / "price_findings.json").write_text(json.dumps(findings, indent=2) + "\n")
    (OUTPUT / "choice.json").write_text(json.dumps(winner, indent=2) + "\n")
    print("\nprice_findings")
    print(json.dumps(findings, indent=2))
    print("\nchoice")
    print(json.dumps(winner, indent=2))


if __name__ == "__main__":
    main()
