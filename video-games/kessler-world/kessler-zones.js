/* Kessler IV Explorer: zone content (regions, points of interest, hot zones) and terrain height fields.
   Edit this file to add zones or change map content. */
import { ss, fbm, ridged, makeNoise, pad } from './kessler-util.js';

/* ======================================================================
   World data — three zones on the fictional planet Kessler IV
   Map space: u,v in [-1,1]; world x,z = u*100, v*100. 1 world unit = 10 m.
   ====================================================================== */
export const TYPES = {
  lm:{label:'LANDMARK', pre:'LM'},
  lr:{label:'DATA LOG', pre:'LR'},
  ex:{label:'EXFIL POINT', pre:'EX'},
  ca:{label:'SUPPLY CACHE', pre:'CA'}
};
export const ICON = {
  lm:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
  lr:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L8 13.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  ex:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 12V4.5M4.6 7.6 8 4.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  ca:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5.2v5.6M5.2 8h5.6" stroke="currentColor" stroke-width="1.5"/></svg>',
  warn:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4.2M8 11.6v1.4" stroke="currentColor" stroke-width="1.6"/></svg>'
};

export const ZONES = [
{
  id:'bastion', name:'BASTION', code:'KS-IV/BA', crew:4, hostile:3, seed:4127, datum:1180, ci:0.5, water:null,
  tint:[0.25,0.55,1.0],
  blurb:'A brine refinery and command post on a basalt plateau, abandoned mid-shift when the orbital relay went quiet. Dense buildings and short sightlines.',
  mask:{r0:0.6, r1:0.95, wob:0.14},
  height(n, u, v){
    const b = fbm(n, u * 2.2 + 3, v * 2.2 - 1, 5);
    const hills = 7 + b * 9 + ridged(n, u * 2.6 + 11, v * 2.6 + 4, 4) * 12;
    const r = Math.hypot(u * 0.95, v * 1.08) + 0.07 * n(u * 3.5 + 20, v * 3.5);
    const p = 1 - ss(0.36, 0.6, r);
    return hills * (1 - p) + (18 + b * 0.8) * p;
  },
  infill:{cell:5, radius:0.5, rot:0.21, p:0.58, hmin:1.2, hmax:7, minMask:0.9},
  regions:[
    {name:'LANDING ARRAY', u:0.06, v:-0.5, threat:'med', style:'pads', rot:0.21,
     desc:'Six landing pads on a cut terrace above the yards. The crane gantries give long sightlines in every direction, and anyone up there can see you too.'},
    {name:'COMMAND SPIRE', u:0.02, v:-0.06, threat:'high', style:'tower', rot:0.21,
     desc:'The tallest structure on the plateau by a wide margin. The relay deck at the top still answers pings on the old command band.'},
    {name:'HABITATION RING', u:0.42, v:0.04, threat:'low', style:'ring', rot:0,
     desc:'Crew quarters arranged around a sealed atrium. Narrow corridors and a lot of doors, which makes it a good place to lose a tail.'},
    {name:'REFINERY', u:-0.36, v:0.3, threat:'high', style:'tanks', rot:0.21,
     desc:'Cracking towers and pipe racks over a brine sump. It is loud enough here that you will not hear footsteps.'},
    {name:'CARGO YARDS', u:-0.44, v:-0.22, threat:'med', style:'stacks', rot:0.21,
     desc:'Container stacks up to four high on a gridded apron. The lanes between them change whenever the stackers cycle.'},
    {name:'RELAY MAST', u:0.3, v:0.52, threat:'low', style:'mast', rot:0, flat:{r:0.05},
     desc:'A lattice mast on the south knoll. Climbing it boosts uplink range across the whole sector.'}
  ],
  roads:[[0,1],[1,2],[1,3],[1,4],[4,0],[2,5],[4,3]],
  pois:[
    {t:'lm', name:'Gantry 4 crane', u:0.15, v:-0.57, note:'Highest point on the pad terrace, with a line of sight to the yards and the spire.'},
    {t:'lm', name:'Spire relay deck', u:0.08, v:-0.12, note:'Still answers on the old command band. Reached by the east stair core.'},

    {t:'lm', name:'Atrium skylight', u:0.49, v:0.11, note:'A cracked glass dome over the habitation atrium. It drops straight into the ring.'},
    {t:'lm', name:'Sump outflow', u:-0.44, v:0.42, note:'Brine runoff from the refinery. The ground is soft and loud underfoot.'},
    {t:'lr', name:'Pad controller shift log', u:-0.03, v:-0.44, note:'Last entry at 04:12. The controller logged three landings that never arrived.'},
    {t:'lr', name:'Ration ledger', u:0.35, v:0.13, note:'Rations drop by four portions a day for the final week.'},
    {t:'lr', name:'Foreman’s audio note', u:-0.29, v:0.23, note:'Two minutes of pump noise and one sentence about the sump.'},
    {t:'lr', name:'Relay fault report', u:0.25, v:0.46, note:'The uplink did not fail. Someone changed the frequency.'},
    {t:'lr', name:'Evacuation roster', u:-0.12, v:0.03, note:'Forty-one names. Thirty-eight are checked off.'},
    {t:'lr', name:'Unsent message', u:-0.52, v:-0.3, note:'Addressed to a family on the orbital. It was never sent.'},
    {t:'ex', name:'North pad lift', u:0.0, v:-0.64, note:'Freight lift to orbit. Call time is 90 seconds and it is loud when it arrives.'},
    {t:'ex', name:'South knoll beacon', u:0.38, v:0.62, note:'Ground beacon for a pickup flight. Exposed on the knoll.'},
    {t:'ca', name:'Tool locker', u:-0.37, v:-0.13, note:'Cutting torch and spare filters.'},
    {t:'ca', name:'Med crate', u:0.53, v:-0.03, note:'Sealed trauma kit. The seal is intact.'},
    {t:'ca', name:'Ammo cage', u:-0.25, v:0.38, note:'Chain-link cage behind the cracking towers. The lock has been cut.'}
  ],
  hot:[
    {name:'REACTOR VENT', u:-0.36, v:0.32, r:0.1, desc:'Superheated brine vents on a 90-second cycle. Stay off the grates.'},
    {name:'SPIRE OVERWATCH', u:0.02, v:-0.06, r:0.16, desc:'Hostiles hold the upper decks of the spire. Anything in the open below is visible.'},
    {name:'YARD CROSSFIRE', u:-0.44, v:-0.22, r:0.11, desc:'Two stacker lanes with clear lines of fire from both ends.'}
  ]
},
{
  id:'ridgeback', name:'RIDGEBACK', code:'KS-IV/RB', crew:3, hostile:2, seed:9031, datum:1240, ci:1.0, water:null,
  tint:[0.3,0.6,1.0],
  blurb:'Shale ridges north of the plateau. A survey dome and a wind farm hold the high ground, and the only road runs through one blasted cut.',
  mask:{r0:0.62, r1:0.96, wob:0.16},
  height(n, u, v){
    const r = ridged(n, u * 1.7 + 7, v * 1.7 - 3, 5);
    let h = 6 + r * 36 + fbm(n, u * 5, v * 5, 3) * 2.5;
    const cx = -0.08 + 0.12 * Math.sin(v * 3.2);
    const c = 1 - ss(0.025, 0.11, Math.abs(u - cx));
    return h * (1 - c * 0.8) + (8 + v * 3) * c * 0.8;
  },
  infill:null,
  regions:[
    {name:'NORTH PASS', u:-0.14, v:-0.6, threat:'med', style:'huts', rot:0.4,
     desc:'The only road in from the north. A switchback climbs between two shoulders of rock, with no cover on the last bend.'},
    {name:'OBSERVATORY', u:0.4, v:-0.28, threat:'low', style:'dome', rot:0.3, flat:{r:0.07},
     desc:'A survey dome on the highest summit, looking straight down the pass. Its tracking scope still slews toward the relay.'},
    {name:'SHALE CUT', u:-0.06, v:0.02, threat:'high', style:'adit', rot:0.1,
     desc:'A blasted road cut through the ridge, with sheer rock walls on both sides and loose scree underfoot.'},
    {name:'WIND FARM', u:-0.5, v:-0.12, threat:'low', style:'turbines', rot:1.25,
     desc:'Nine turbines on the western ridge. Three still turn, and their shadows sweep the slope every few seconds.'},
    {name:'THE SPINE', u:0.14, v:0.46, threat:'high', style:'huts', rot:-0.6,
     desc:'A knife-edge ridge running south. Fast to cross and exposed the whole way.'},
    {name:'SIGNAL CAVE', u:-0.42, v:0.46, threat:'med', style:'adit', rot:0.8, flat:{r:0.045},
     desc:'A collapsed mine adit with a transmitter wired into the rock face. Reception is strongest at the mouth.'}
  ],
  roads:[[0,2],[2,4],[0,3],[3,5],[2,5],[0,1],[1,2]],
  pois:[
    {t:'lm', name:'Switchback cairn', u:-0.21, v:-0.69, note:'A survey cairn at the last bend before the pass. Visible from the observatory.'},
    {t:'lm', name:'Tracking scope', u:0.44, v:-0.33, note:'Still slews toward the relay every 40 minutes.'},
    {t:'lm', name:'Turbine 6', u:-0.55, v:-0.06, note:'The only turbine with a working ladder. The view covers both slopes.'},
    {t:'lr', name:'Survey notebook', u:0.33, v:-0.21, note:'Hand-drawn contour corrections. The ridge has moved 2 m since the last map.'},
    {t:'lr', name:'Blasting schedule', u:0.0, v:0.09, note:'Charges for the cut were set twice. Only one set went off.'},
    {t:'lr', name:'Lineman’s log', u:-0.44, v:-0.2, note:'Turbines 3, 4 and 7 tripped in the same second.'},
    {t:'lr', name:'Cave recording', u:-0.37, v:0.51, note:'Seven minutes of carrier tone with a voice underneath it.'},
    {t:'lr', name:'Trail notes', u:0.19, v:0.39, note:'Advice for crossing the spine: go at dusk and go fast.'},
    {t:'ex', name:'Pass landing zone', u:-0.07, v:-0.77, note:'Flat ground below the switchback, with room for one lander.'},
    {t:'ex', name:'Spine end beacon', u:0.21, v:0.64, note:'Beacon at the south tip of the spine. A long walk under clear skies.'},
    {t:'ca', name:'Survey cache', u:0.47, v:-0.2, note:'Climbing rope and a thermal blanket.'},
    {t:'ca', name:'Blast shelter', u:-0.12, v:-0.03, note:'A concrete box beside the cut with two sealed crates.'},
    {t:'ca', name:'Cave stores', u:-0.49, v:0.41, note:'Dry rations, still in date.'}
  ],
  hot:[
    {name:'SCREE SLIDE', u:-0.05, v:0.06, r:0.12, desc:'Loose shale above the cut. Gunfire brings it down.'},
    {name:'SPINE SNIPER LINE', u:0.14, v:0.44, r:0.15, desc:'Long sightlines from the observatory side cover the whole ridge.'}
  ]
},
{
  id:'silt', name:'SILT BASIN', code:'KS-IV/SB', crew:4, hostile:3, seed:2718, datum:1015, ci:0.35, water:3.0,
  tint:[0.2,0.6,0.95],
  blurb:'A drowned lowland of brine channels and reed flats. The causeway is the only dry crossing. Everything else is waist-deep and slow.',
  mask:{r0:0.6, r1:0.95, wob:0.13},
  height(n, u, v){
    let h = 2.6 + fbm(n, u * 2.6 + 1, v * 2.6 + 9, 5) * 2.2 + fbm(n, u * 9, v * 9, 2) * 0.5;
    h += Math.max(0, fbm(n, u * 1.4 - 6, v * 1.4 + 2, 4)) * 8;
    const ch = Math.abs(n(u * 2.2 + 3, v * 2.2 - 5));
    return h - 2.2 * (1 - ss(0, 0.09, ch));
  },
  infill:{cell:7, radius:0.62, rot:-0.3, p:0.2, hmin:1, hmax:3, minMask:0.8, aboveWater:0.6},
  regions:[
    {name:'PUMP STATION', u:0.02, v:-0.42, threat:'med', style:'tanks', rot:-0.3, flat:{r:0.09, h:5},
     desc:'Four intake pumps that once drained the basin into the refinery line. The control hall floods at high tide.'},
    {name:'REED FLATS', u:-0.46, v:-0.06, threat:'low', style:'reeds', rot:0,
     desc:'Shoulder-high reeds over standing water. Visibility drops to a few meters.'},
    {name:'SUNKEN DOCK', u:0.44, v:0.1, threat:'high', style:'dock', rot:0.5, flat:{r:0.08, h:2.2},
     desc:'A barge dock that settled two meters into the silt. The rooftops are the only stable footing.'},
    {name:'HATCHERY', u:-0.2, v:0.44, threat:'med', style:'hatch', rot:-0.3, flat:{r:0.08, h:4.4},
     desc:'Long brine tanks under a broken roof. Something still moves in the water.'},
    {name:'CAUSEWAY', u:0.06, v:0.04, threat:'med', style:'causeway', rot:-0.12,
     desc:'A raised road across the basin on concrete piers. Fast and dry, with nowhere to hide.'},
    {name:'WEATHER BUOY', u:0.48, v:-0.5, threat:'low', style:'buoy', rot:0,
     desc:'A tethered instrument mast at the deepest point of the basin. Its beacon still blinks on a six-second cycle.'}
  ],
  roads:[[0,4],[4,3],[4,2],[1,4],[0,5],[1,3]],
  pois:[
    {t:'lm', name:'Intake 2', u:0.07, v:-0.47, note:'The only pump still turning. You can hear it across the basin.'},
    {t:'lm', name:'Causeway midspan', u:0.1, v:0.08, note:'The highest point of the causeway deck, with sightlines in every direction.'},
    {t:'lm', name:'Dock crane', u:0.5, v:0.06, note:'Leaning 12° and still holding a container over the water.'},
    {t:'lm', name:'Buoy beacon', u:0.52, v:-0.55, note:'Blinks on a six-second cycle. Easy to mistake for a contact at night.'},
    {t:'lr', name:'Tide table', u:-0.04, v:-0.37, note:'Hand-corrected for a moon that runs 3 minutes late.'},
    {t:'lr', name:'Hatchery tank log', u:-0.25, v:0.41, note:'Stock counts stop on the day the water turned warm.'},
    {t:'lr', name:'Dockmaster’s ledger', u:0.4, v:0.16, note:'The final barge is listed as arrived. Its berth is empty.'},
    {t:'lr', name:'Reed cutter’s notes', u:-0.48, v:0.01, note:'Paths through the flats, marked by the colour of the reeds.'},
    {t:'ex', name:'Pump roof lift', u:-0.04, v:-0.5, note:'Roof pad on the pump hall. Dry at any tide.'},
    {t:'ex', name:'Hatchery skiff', u:-0.28, v:0.55, note:'A flat-bottomed skiff tied to the south wall. It seats four.'},
    {t:'ca', name:'Dry box', u:0.12, v:-0.06, note:'Sealed under the causeway deck at pier 9.'},
    {t:'ca', name:'Dock locker', u:0.47, v:0.18, note:'A waterproof locker on the dock roof.'},
    {t:'ca', name:'Reed blind cache', u:-0.53, v:-0.14, note:'A hunter’s blind in the reeds with rations and flares.'}
  ],
  hot:[
    {name:'DEEP CHANNEL', u:0.26, v:-0.12, r:0.12, desc:'The current runs fast under the surface and sweeps swimmers toward the pumps.'},
    {name:'HATCHERY TANKS', u:-0.2, v:0.45, r:0.1, desc:'The water in the tanks is warm, and something in it is hunting.'},
    {name:'DOCK COLLAPSE', u:0.46, v:0.1, r:0.09, desc:'The east roof is held up by a single beam.'}
  ]
}];

// assign codes
for (const Z of ZONES){
  const k = {lm:0, lr:0, ex:0, ca:0};
  Z.pois.forEach(p => { k[p.t]++; p.code = TYPES[p.t].pre + '-' + pad(k[p.t]); });
  Z.regions.forEach((r, i) => { r.code = 'R-' + pad(i + 1); });
}

/* Height field per zone: raw terrain, region flattening, island mask.
   `hu` is the flattened height without the island mask, used when zones are stitched into one world. */
export function makeField(Z){
  const n = makeNoise(Z.seed), nm = makeNoise(Z.seed + 77);
  const raw = (u, v) => Z.height(n, u, v);
  const flats = Z.regions.filter(r => r.flat).map(r => ({u:r.u, v:r.v, r:r.flat.r, h:r.flat.h != null ? r.flat.h : raw(r.u, r.v)}));
  const mk = Z.mask;
  const mask = (u, v) => 1 - ss(mk.r0, mk.r1, Math.hypot(u, v) + mk.wob * nm(u * 1.7 + 4, v * 1.7 - 2));
  const hu = (u, v) => {
    let y = raw(u, v);
    for (const f of flats){ const w = 1 - ss(f.r * 0.6, f.r, Math.hypot(u - f.u, v - f.v)); y = y * (1 - w) + f.h * w; }
    return y;
  };
  const h = (u, v) => Math.max(0, hu(u, v) * mask(u, v));
  return {h, hu, mask};
}
