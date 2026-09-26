// Probe: does the price extraction pick the PACK price, not the unit price?
// Run: node --experimental-strip-types scripts/compare-probe.ts
import { priceAtShop, type Shop } from '../lib/tavily.ts';

const shops: Shop[] = [
  { id: 't', name: 'Tesco', base_url: 'tesco.com', scope: 'consumables' },
  { id: 'w', name: 'Waitrose', base_url: 'waitrose.com', scope: 'consumables' },
  { id: 'o', name: 'Ocado', base_url: 'ocado.com', scope: 'consumables' },
];

for (const s of shops) {
  try {
    const f = await priceAtShop(s, 'coffee_beans_1kg');
    if (!f) {
      console.log(`${s.name.padEnd(9)} -> no price found`);
    } else {
      console.log(`${s.name.padEnd(9)} -> £${f.price.toFixed(2)}  ${f.evidence_url.slice(0, 72)}`);
    }
  } catch (e) {
    console.log(`${s.name.padEnd(9)} -> ERROR ${(e as Error).message}`);
  }
}
