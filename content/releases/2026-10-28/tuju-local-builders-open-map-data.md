# TuJu, Local Builders, and the Case for Open Map Data

A developer can make an argument more forcefully by shipping a useful screen than by writing another angry thread. That is part of the appeal of the discussion around TuJu: local builders are showing what Malaysian navigation and transport information could look like when someone starts with a concrete journey. The useful question is what their work reveals about the infrastructure beneath the interface.

Harith Hilmi's [critique of TuJu](https://harithilmi.com/tuju/) argues for open Malaysian map data rather than another isolated application. His [Klang Valley bus map](https://transit.harithilmi.com/klang-valley/bus/08#map=17/3.20747/101.68943) makes that argument tangible. It also gives us a reason to compare carefully. A highway navigator, a transit map and an open data service solve different problems. Treating them as interchangeable makes both the criticism and the defence less useful.

## Compare the journeys first

TuJu describes itself as a highway navigation application developed through a partnership between the Malaysian Highway Authority, LLM, and Prosignal Consortium. Its [official background page](https://www.tuju.my/tentang) dates that collaboration to 2022. The [product page](https://www.tuju.my/tuju) advertises highway-oriented information including toll calculations, traffic cameras, rest stops and emergency assistance. Those are reasonable needs for someone driving between towns.

A bus passenger needs a different answer: where is the stop, which direction does the route run, and is there enough information to decide whether to wait? Harith's route 08 page draws a loop between KTM/MRT Kampung Batu and Chow Kit and explicitly reports when a timetable is unavailable. That admission matters. A map can be useful without pretending that an uncertain arrival time is a reliable promise.

These products can therefore be judged against specific tasks. A toll estimate is relevant to a driver. A clear route shape and interchange are relevant to a passenger. Neither feature proves that one application is universally superior. A fair comparison would test the same journey, device and time window, including accessibility, stale data and failures. Screenshots and launch claims cannot substitute for that work.

## The strongest local alternative may be a reusable feed

Malaysia already has an example of infrastructure that lets independent products exist. The government's [GTFS Realtime documentation](https://developer.data.gov.my/realtime-api/gtfs-realtime.en) describes vehicle-position feeds from KTMB, Prasarana and BAS.MY, published in a standard format under CC BY 4.0. It documents update intervals and known data problems. At the time of this article, that page distinguishes available vehicle positions from planned service alerts and trip updates.

That distinction gives a builder something better than a vague promise of openness: a contract to build against. A small team can interpret a feed, present it differently and explain its gaps. A student can compare observations across days. Someone can design a low-bandwidth interface without persuading an agency to commission a separate official app for that audience.

Open data still needs maintenance. A feed with identifiers that change unexpectedly can break a route lookup even while its endpoint remains online. An old vehicle position can look reassuringly precise on a map. Documentation, timestamps, stable identifiers and a way to report errors are part of the product. Making a download public once does not finish the job.

## A dependency is not automatically a contradiction

Harith raises concerns about the mapping services beneath TuJu. Those observations deserve a technical response, but a third-party SDK is not, by itself, proof of waste or wrongdoing. Many applications sensibly purchase capabilities they cannot maintain. The relevant questions are which dependency is necessary, what data crosses that boundary, and whether the organisation can replace the supplier without rebuilding everything.

Likewise, multiplying a public API price by an assumed request count produces a scenario, not a verified invoice. A production agreement may have different pricing, caching, quotas or licensing. Without those records, a dramatic cost calculation should stay labelled as an estimate. Criticism becomes stronger when its evidence is narrower and reproducible.

The same standard should apply to claims of sovereignty. Hosting an app locally does not tell users where every route request, location event or map tile is processed. A useful technical disclosure would describe the actual data flow in plain language. The [TuJu privacy policy](https://www.tuju.my/policy/privacy) is a starting point for that conversation; it should be read alongside the application's current behaviour rather than treated as an independent audit.

## What a public project should leave behind

A government-backed application can create value beyond its own install count. Where licensing and safety permit, it can leave behind documented road restrictions, authoritative toll information, machine-readable closure notices and predictable update processes. Other teams could then build interfaces for motorcycles, rural connectivity, accessibility needs or public transport connections.

This is a procurement question as much as a design question. A contract can specify whether the authority receives reusable datasets, migration documentation and the right to operate the service after a vendor changes. It can require a correction process and measurable freshness targets. These deliverables are less photogenic than an app launch, but they determine how much future work the public has to buy again.

An open layer also makes comparison more meaningful. If competing interfaces consume the same published source, differences in usability become easier to identify. If an independent builder discovers a bad stop coordinate, a correction can improve every downstream product instead of disappearing into a private support ticket. Competition and collaboration can happen at the same time.

## Give builders a durable way to contribute

Local projects such as [PINTAZ](https://pintazapp.com/) and Harith's transit map show that Malaysian developers are willing to work on everyday movement. Their existence should not be reduced to a contest over who can embarrass an institution fastest. A prototype can demonstrate a better interaction while still needing funding, support and operational safeguards before people depend on it daily.

The constructive response is to make participation easier: publish usable interfaces, acknowledge upstream sources, accept corrections and explain why some information cannot be released. Independent teams should also disclose their limits. A beta label, a missing timetable notice and a visible update time can earn more trust than an ambitious feature list with no failure state.

The point worth proving is that public information can support more than one good product. TuJu should be evaluated on its highway tasks and on what it contributes to the wider ecosystem. Local alternatives should be evaluated on the journeys they actually help. A shared, maintained data foundation would let both improve, and would keep that progress available after this particular argument leaves the timeline.

Research checked 28 October 2026. Product features above are attributed descriptions, not results of a comparative road test.
