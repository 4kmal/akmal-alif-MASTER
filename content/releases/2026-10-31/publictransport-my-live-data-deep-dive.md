# How publictransport.my Puts Klang Valley Buses on a Live Map

Anyone who takes the bus in Kuala Lumpur knows the moment: you reach the stop, look down the road, and have no idea whether the bus is two minutes away or twenty-five. Lyrad Boon built [publictransport.my](https://publictransport.my/) because he was tired of that moment. In a post to the Developer Kaki group, he described a single map covering RapidKL buses, the Ampang, Sri Petaling and Kelana Jaya LRT lines, the Kajang and Putrajaya MRT lines, the KL Monorail and KTM Komuter. It plans journeys across walking, buses and trains, and it tells you when to leave [1].

His pitch rests on one claim: timetables are not enough for buses stuck in the same traffic as everyone else, so the map should show where the buses actually are. In the comments, readers asked the obvious question, which was where the live GPS comes from. His answer named two sources: the government's official GTFS Realtime feed, and Prasarana's own bus kiosk website, which he said he had reverse engineered [1]. This post traces exactly how those pieces fit together, using only what the site and the kiosk publicly serve to every visitor.

> Read the original: [Lyrad Boon's post on Developer Kaki](https://www.facebook.com/groups/developerkaki/permalink/3018605225152037/), including the comment thread about the data sources. You can also open Prasarana's [MyRapid Bus Kiosk](https://myrapidbus.prasarana.com.my/kiosk) to compare it with publictransport.my.

## The short answer

publictransport.my combines three layers. Buses come from two live feeds of the same underlying system. The first is the official GTFS Realtime feed on data.gov.my, which the site's server polls and redistributes [2]. The second is the Socket.IO feed behind the MyRapid Bus Kiosk, which your browser opens directly [3]. Trains are a different matter: they are placed on the map from published timetables and headways, not from live tracking. The site's own About page says so plainly, describing train positions as "estimated from timetables, not live tracking" [4]. Underneath everything is an OpenStreetMap basemap served as vector tiles.

::diagram publictransport-live-data | Figure 1. How publictransport.my assembles live buses, estimated trains and its basemap. Observed 31 October 2026; simplified.

## GTFS and GTFS Realtime in two minutes

GTFS, the General Transit Feed Specification, is the shared language most transit apps speak. A static GTFS feed is a ZIP of plain-text tables: stops, routes, trips, stop times, service calendars and, where available, route shapes and service frequencies [5]. GTFS Realtime layers live updates on top of that schedule. A feed is a Protocol Buffers message containing entities such as vehicle positions, trip updates and service alerts [6].

A vehicle position can carry the trip and route a bus is serving, its latitude and longitude, bearing, speed, current stop and a timestamp for when the position was measured [7]. The specification's best practices ask producers to refresh feeds at least every 30 seconds and to avoid publishing positions older than 90 seconds [8]. Those numbers matter, because they set the floor for how fresh any "live" map can be.

## Source 1: the official feed on data.gov.my

Malaysia's open data portal publishes GTFS Realtime vehicle positions for KTMB, Prasarana and BAS.MY. URLs follow a simple pattern, `api.data.gov.my/gtfs-realtime/vehicle-position/<agency>`. Prasarana's feed takes a category such as `rapid-bus-kl`, `rapid-bus-mrtfeeder` or `rapid-bus-penang`. BAS.MY covers cities including Kangar, Alor Setar, Kota Bharu, Kuala Terengganu, Ipoh, Seremban, Melaka, Johor Bahru and Kuching [2]. The documentation says every vehicle position feed updates every 30 seconds and is licensed CC BY 4.0. It also says trip updates and service alerts are planned for 2026, so for now the feed tells you where vehicles are but not when they will arrive [2].

There is one more constraint that shapes the whole design. The portal limits every API, GTFS included, to four requests per minute, and further requests fail with an HTTP 429 error [9]. A web page cannot have every visitor poll the feed directly. Instead, publictransport.my runs its own server, which fetches the protobuf feeds and re-serves them as compact JSON at `/api/vehicles`. When I inspected it, each vehicle carried an ID, route, trip, direction, latitude, longitude, bearing, speed in metres per second and a timestamp. One snapshot held 257 vehicles across RapidKL routes, MRT feeder routes and several BAS.MY cities, with position ages between about one and nine minutes [10].

Live updates then reach your phone over a WebSocket at `/api/vehicles/stream`. The browser tells the server which map areas it is looking at, in what the code calls a "demand" message, and the server sends only the buses inside them [10]. That is the classic fan-out pattern: one upstream poll serves many readers, and each reader receives only the slice it needs.

## Source 2: the kiosk's socket

Prasarana also runs the [MyRapid Bus Kiosk](https://myrapidbus.prasarana.com.my/kiosk), a public web map of its buses. Under the hood it is an older stack: AngularJS and jQuery, Leaflet 1.3.4 with standard OpenStreetMap raster tiles, the pako compression library and a Socket.IO client. Imperva's Incapsula bot protection sits in front [3]. The page says bus movement updates every 30 seconds, but its script behaves more eagerly.

The kiosk's inline script connects with `io.connect('https://rapidbus-socketio-avl.prasarana.com.my', { transports: ['websocket'] })`. It then emits an `onFts-reload` event carrying a session ID, a user ID, a provider code such as `RKL` and an optional route. A timer repeats that request every 5,000 milliseconds. Replies arrive as `onFts-client` events whose payload is gzip-compressed JSON, which the page inflates with pako before redrawing its markers [3]. The "AVL" in the hostname stands for automatic vehicle location, the GPS fleet-tracking system behind the buses. "FTS" plausibly refers to the fleet tracking system the feed comes from, although that expansion is my inference.

publictransport.my talks to the same server without loading the Socket.IO library. Its client opens a raw WebSocket to the `/socket.io/?EIO=3&transport=websocket` endpoint. It then speaks the old Engine.IO version 3 framing by hand [10][11]:

- A packet starting with `0` opens the session and announces the ping interval.
- `2` is a ping, answered with `3`.
- `40` confirms the Socket.IO connection.
- `42` carries an event as a JSON array.

Once connected, it sends `42["onFts-reload",{…,"provider":"RKL"}]` every five seconds. It decodes each `onFts-client` payload with the browser's built-in `DecompressionStream('gzip')` instead of pako [10][12].

The decoded records are mapped into the same shape as the official feed:

- `bus_no` becomes the vehicle ID.
- `dir` values of `01` and `02` become GTFS direction IDs.
- `angle` becomes the bearing.
- `dt_gps` is parsed as Malaysian time.

Any fix older than 120 seconds is discarded [10]. The client is also built to fail gracefully. A user preference stored as `tp-live-source` defaults to this AVL source. Three failed snapshots in a row mark it unhealthy and switch the map to the GTFS stream. Fifteen seconds of silence triggers a reconnect with backoff of one, two, five and then ten seconds. The socket pauses entirely while the browser tab is hidden [10].

None of this is secret. The same host, event names and gzip payload were described in a python-socketio discussion in 2022 [13]. They came up again in an August 2026 issue on the data.gov.my repository, where a developer whose `rapid-bus-kl` GTFS feed was returning no vehicles shared a working client and asked others to use it responsibly [14]. That issue is also the best argument for having two sources. When the official feed goes quiet, the kiosk's feed may still be talking.

## Why the trains are estimated

A natural question is how the map shows live LRT and MRT trains. The honest answer is that it doesn't, and it says so. The data.gov.my documentation states that `rapid-rail-kl`, the Prasarana rail category, has a static timetable feed but "does not yet have stable realtime feeds" [2]. KTMB does publish a realtime feed. One independent developer reported in September 2026 that it carried only ETS intercity trains, although I could not confirm that independently [15].

publictransport.my fills the gap with an estimator. Its `/api/rail/movements` endpoint returns a list of train runs marked `estimated: true`, cached for 30 seconds, with a validity window a couple of minutes ahead [10]. Each run carries a line, destination, colour, path and the stops it calls at, with arrival and departure times. The `timing` field tells you how the run was derived. Lines such as the Kelana Jaya, Ampang, Sri Petaling, Kajang, Putrajaya and Monorail lines use `headway`, meaning the timetable gives a frequency ("a train every few minutes") rather than individual departures. KTM lines such as Port Klang and Seremban use `schedule`, meaning stop-by-stop times [10]. The browser then animates each estimated train along its path between those times.

Rail service in the Klang Valley is frequent, so this estimate is useful for seeing which way trains run and roughly where they should be. It is not tracking, and the site's About page is right to say so [4].

## Map and motion

The basemap is self-hosted. MapLibre GL renders vector tiles from a PMTiles archive on `tiles.publictransport.my`, using Protomaps' styles, fonts and sprites. The data comes from OpenStreetMap under the Open Database License, and place search credits Photon by komoot [4][16][17]. PMTiles packs a whole tile pyramid into one file read with HTTP range requests, so a small team can serve a national basemap without per-request tile fees [17].

The interface is a React 19 application that refreshes data on fixed intervals: rail movements every 30 seconds and departure boards every 60 seconds [10]. GPS fixes arrive in jumps, so the map projects each fix onto its route's shape, measuring how far along the route the bus is. It then animates buses between fixes with `requestAnimationFrame` and moves geometry work into a Web Worker [10]. That smoothing is cosmetic but important. A bus that teleports every 30 seconds feels broken even when the data is fine.

## How "Leave in 2 min" is worked out

The trip planner runs on the server through endpoints such as `/api/journeys` and `/api/board`, which take your origin, destination, walking time and a buffer [10]. On the client, the bus arrival estimate is deliberately simple. It takes the remaining distance along the route shape, computed with the haversine formula, and divides it by the bus's speed. That speed is clamped between 2 and 25 metres per second, and it falls back to 8.33 m/s, or 30 km/h, when the bus reports none [10].

The departure phrase follows clear rules: under a minute it says "Leave now", under an hour "Leave in N min", and beyond that "Leave at" a clock time [10]. When no live vehicle is available it says "Schedule only". When one is, it shows "High", "Medium" or "Low" confidence with a plus-or-minus margin in minutes [10]. That honesty about uncertainty is good product design. Research on Seattle's OneBusAway found that riders using real-time information waited almost two minutes less than those using schedules, and no longer overestimated their waits [18][19].

## Cost, fragility and responsibility

One commenter on the original post raised cost, noting that displaying all of this live data means calling APIs constantly [1]. The design above answers part of that. The official feed is free to use but rate-limited, so the server polls it once and fans it out. Self-hosted PMTiles avoids paying a commercial tile provider for every map view. The remaining costs are the WebSocket fan-out and hosting, behind Cloudflare.

The kiosk path costs publictransport.my nothing per user, because each browser connects to Prasarana directly. That shifts load onto an undocumented service that runs an old protocol behind bot protection. It could change or block third-party clients at any time, and its terms of use for outside apps are not published. The client's behaviour is restrained: one connection per visible tab, a five-second cadence that matches the kiosk's own, a pause when hidden and backoff on failure. Its automatic fallback to the official feed is the right safety net. Anyone copying the approach should keep those safeguards and prefer the documented feed wherever it works.

## What the data still needs

publictransport.my arrives in a particular moment. In October 2026 the government urged drivers to switch from Waze to TuJu, the Malaysian Highway Authority's navigation app, and a surge of users brought disruptions and a public apology [20][21]. Lyrad's post ties that episode to a broader call for local developers to build the tools people would choose for themselves [1]. I made a related argument in [TuJu, Local Builders, and the Case for Open Map Data](https://www.akmalalif.com/blog/tuju-local-builders-open-map-data): durable public data does more for everyone than any single app.

This project shows the next steps clearly. Trip updates would turn positions into official arrival predictions. A stable realtime feed for `rapid-rail-kl` would make the trains genuinely live. And if the kiosk's feed is fresher or more reliable than the published one, the fix is to publish it properly, so builders don't have to reverse engineer a public service to get the same data.

## Methodology

On 31 October 2026, between about 1 pm and 2 pm Malaysian time, I loaded publictransport.my and the MyRapid Bus Kiosk in a desktop browser. I recorded the network requests each page made and read the JavaScript each site serves publicly. I requested `/api/vehicles`, `/api/rail/movements` and `/api/rail/network` a handful of times to inspect their response formats. There was no automated polling and no load testing, and I did not connect to Prasarana's socket outside the kiosk page itself.

Details read from minified code may be imprecise, and both sites can change at any time. The inferences above are labelled as such. I have not confirmed these findings with the developer, and I am not affiliated with publictransport.my, Prasarana or KTMB.

## Sources

1. Boon, L. (2026, October). Post and comment thread on publictransport.my [Facebook group post]. Developer Kaki. [https://www.facebook.com/groups/developerkaki/permalink/3018605225152037/](https://www.facebook.com/groups/developerkaki/permalink/3018605225152037/)
2. Government of Malaysia. (2026). *GTFS Realtime API endpoint*. data.gov.my Developer Documentation. [https://developer.data.gov.my/realtime-api/gtfs-realtime](https://developer.data.gov.my/realtime-api/gtfs-realtime)
3. Prasarana Malaysia Berhad. (n.d.). *MyRapid Bus Kiosk* [Web application and page source]. Observed 31 October 2026. [https://myrapidbus.prasarana.com.my/kiosk](https://myrapidbus.prasarana.com.my/kiosk)
4. publictransport.my. (2026). *About* [In-app page: sources and disclaimer]. Observed 31 October 2026. [https://publictransport.my/](https://publictransport.my/)
5. MobilityData. (2026, April 27 revision). *GTFS Schedule reference*. [https://gtfs.org/documentation/schedule/reference/](https://gtfs.org/documentation/schedule/reference/)
6. Google. (2024). *GTFS Realtime overview*. Google for Developers. [https://developers.google.com/transit/gtfs-realtime](https://developers.google.com/transit/gtfs-realtime)
7. MobilityData. (n.d.). *GTFS Realtime reference*. [https://gtfs.org/documentation/realtime/reference/](https://gtfs.org/documentation/realtime/reference/)
8. MobilityData. (n.d.). *GTFS Realtime best practices*. [https://gtfs.org/documentation/realtime/realtime-best-practices/](https://gtfs.org/documentation/realtime/realtime-best-practices/)
9. Government of Malaysia. (2026). *Throttling rates*. data.gov.my Developer Documentation. [https://developer.data.gov.my/rate-limit](https://developer.data.gov.my/rate-limit)
10. publictransport.my. (2026). Network requests (`/api/vehicles`, `/api/vehicles/stream`, `/api/rail/movements`, `/api/rail/network`) and public JavaScript bundles. Observed 31 October 2026. [https://publictransport.my/](https://publictransport.my/)
11. Socket.IO. (n.d.). *Engine.IO protocol*. [https://socket.io/docs/v4/engine-io-protocol/](https://socket.io/docs/v4/engine-io-protocol/)
12. MDN Web Docs. (n.d.). *DecompressionStream*. Mozilla. [https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)
13. imjuzcy & Grinberg, M. (2022, May). *Decode message sent from server when connecting* (Discussion 925). GitHub, python-socketio. [https://github.com/miguelgrinberg/python-socketio/discussions/925](https://github.com/miguelgrinberg/python-socketio/discussions/925)
14. afxq. (2026, August 13). *Feedback for "Gtfs Realtime" - UPDATE* (Issue 659). GitHub, data-gov-my/datagovmy-front. [https://github.com/data-gov-my/datagovmy-front/issues/659](https://github.com/data-gov-my/datagovmy-front/issues/659)
15. tomatogoesrotten. (2026, September 25). *feat: show live buses and KTM ETS trains from GTFS-Realtime* (Pull request 44). GitHub. [https://github.com/tomatogoesrotten/kl_transit/pull/44](https://github.com/tomatogoesrotten/kl_transit/pull/44)
16. OpenStreetMap Foundation. (n.d.). *Copyright and license*. [https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)
17. Protomaps. (n.d.). *PMTiles concepts*. [https://docs.protomaps.com/pmtiles/](https://docs.protomaps.com/pmtiles/)
18. Watkins, K. E., Ferris, B., Borning, A., Rutherford, G. S., & Layton, D. (2011). Where is my bus? Impact of mobile real-time information on the perceived and actual wait time of transit riders. *Transportation Research Part A: Policy and Practice, 45*(8), 839–848. [https://doi.org/10.1016/j.tra.2011.06.010](https://doi.org/10.1016/j.tra.2011.06.010)
19. Ferris, B., Watkins, K., & Borning, A. (2010). OneBusAway: Results from providing real-time arrival information for public transit. *Proceedings of CHI 2010*. ACM. [https://homes.cs.washington.edu/~borning/papers/ferris-chi2010-onebusaway.pdf](https://homes.cs.washington.edu/~borning/papers/ferris-chi2010-onebusaway.pdf)
20. Bernama. (2026, October 20). From Waze to TuJu? Anwar backs Malaysian navigation app over data security concerns. *Malay Mail*. [https://www.malaymail.com/news/malaysia/2026/10/20/from-waze-to-tuju-anwar-backs-local-app-over-data-security-concerns/239923](https://www.malaymail.com/news/malaysia/2026/10/20/from-waze-to-tuju-anwar-backs-local-app-over-data-security-concerns/239923)
21. FMT Reporters. (2026, October 22). LLM apologises for TuJu app disruption. *Free Malaysia Today*. [https://www.freemalaysiatoday.com/category/nation/2026/10/22/llm-apologises-for-tuju-app-disruption](https://www.freemalaysiatoday.com/category/nation/2026/10/22/llm-apologises-for-tuju-app-disruption)

Research checked 31 October 2026. Observations describe publicly served pages at that time and may change.
