# Connectivity validation — version 1.1

Analysis runs in the browser without changing the IFC or GeoPackage. The
Validation tab has its own floor plan, selection and filters. Visibility switches
for **Doors**, **Stairs** and **Elevators** are independent of **Context graph**;
they persist across floor and analysis changes and never change results.
All available door positions are shown, including passing doors and inventoried
doors without graph nodes. Doors without coordinates remain listed in the table.
Square markers represent doors; a gold outline identifies an exterior door.
Vertical markers use S (stair), E (elevator) and R (ramp); D marks the route origin.
Door and vertical-element colours represent local topology checks even in the
exterior-reachability view. The context graph is an independent overlay.

## Required-access scope

Explicit IFC semantic labels identify service shafts (`Patinillo`, `Service shaft`,
`Installation shaft`) and construction zones (`Obra`, `Zona de obra`,
`Construction zone`, `Construction area`). An optional numeric reference suffix
is accepted. The matcher checks the long name, name and space reference.
It does not infer exclusions from missing doors and does not match elevator
shaft descriptions. Original IFC identifiers and attributes remain unchanged.

These spaces receive **Excluded by scope**, appear grey and stay in the inventory.
They count as neither passes nor issues, and never as true negatives. Their
navigable members cannot be used as destinations or transit nodes by exterior
route analysis, or as exits to a served floor. Their existing connections are
reported as evidence so that maintenance access can be reviewed.

Use **Review excluded spaces**, then **Locate**, to inspect each space.
**Access requirement** offers Automatic from IFC labels, Require access and
Intentionally non-accessible. Overrides are stored locally and exported with
the reference. Changing scope clears reference labels because routes elsewhere
may also change; export the current reference first to preserve that review.
Reference imports reject a different scope, model or validator version.

## Checks

| Check | Unit and criterion |
| --- | --- |
| Space connectivity | One case per inventoried space. Required spaces need a navigable member and a link outside their own member set. An isolated semantic parent does not establish isolation. Space-derived elevator cabins use `HSIMG.SourceSpaceIdsByStorey` to locate their stop nodes. |
| Door connections | One case per inventoried door. Every associated side reaches the space interior through this door, without a detour through another door. Interior doors need at least two associated spaces; exterior doors need at least one. |
| Vertical exit to floor | One case per terminal/stop and declared served floor. It must reach a required space on that floor, without `vertical_path` travel or transit through excluded spaces. The elevator's own source cabin cannot satisfy the exit. Missing stops are flagged. Intermediate landings and floors merely crossed by a shaft need no exit. |
| Vertical continuity | One case per pedestrian element. Its internal nodes form one component through its own flights and landings. Vehicle-only ramps are omitted. |
| Internal dead ends | One case per unprotected horizontal axis endpoint/junction. Zero or one distinct neighbour flags a review candidate; legitimate corridor ends can also meet this condition. |
| Integrity | One case per directed arc. Endpoints exist and differ; coordinates and any stored length are finite, and length is non-negative. |
| Exact duplicates | One case per directed arc. Later repeats of ordered endpoints, type, mode and polyline are flagged. Reverse arcs and distinct physical alternatives are retained. |
| Exterior reachability | One case per exterior-door/space/profile combination. Directed traversal respects node and edge permissions. Reaching one interior representative suffices; it does not establish coverage of the whole space. |

Local topology checks do not impose a mobility profile. Exterior routes
distinguish confirmed routes, routes requiring unknown permissions, and no route.
All IFC exterior doors remain included, even if the generator did not mark them
as eligible entrances. Floor identity and edge type determine a floor connection;
no arbitrary elevation tolerance is imposed on stair mesh terminals.

The inspector separates **Evidence**, **What this means**, **Recommended review**
and **Check criterion**. The cases CSV includes those explanations and the scope.
An issue is a review candidate, not an independently confirmed IFC defect.

## Independent references and metrics

Positive means a flagged issue, or an unreachable required space for the chosen
origin and mobility profile. Independent anomaly/normal labels establish TP, FP,
FN and TN. Review passing cases too: otherwise false negatives remain unknown.

- Precision = TP / (TP + FP).
- Recall = TP / (TP + FN).
- F1 = 2 TP / (2 TP + FP + FN).
- Zero denominators are shown as not calculable.
- Unreviewed, unknown and out-of-scope cases are excluded from metrics.
- Tables separately report out-of-scope totals and reviewed evaluable counts.
- Partial reviews describe only the reviewed subset, not the entire building.

Reference JSON records the validator version, dataset SHA-256, profile, scope
overrides, provenance and labels with stable case IDs. Route case IDs include
the profile and origin; topology cases are shared across profiles. Version 1.0
references cannot be imported as version 1.1 because the scope policy changed.
CSV exports include all cases, predictions, reference labels and explanations.

## Included IFC v13 dataset

File: `EPM_IFC_v13_HSIMG_v14.gpkg`.
SHA-256: `c508507dc898162ea7149566668995645534ca05f0a335cd0d945010079a58a8`.
Inventory: 1,517 spaces, 1,401 doors and 80 vertical elements (55 stairs,
13 elevators and 12 ramps). The default scope excludes 96 service shafts and
70 construction zones, leaving 1,351 required destinations.

| Check | Total cases | Out of scope | Automatic issues |
| --- | ---: | ---: | ---: |
| Space connectivity | 1,517 | 166 | 167 |
| Door connections | 1,401 | 0 | 103 |
| Stair floor exits | 110 | 0 | 3 |
| Elevator floor exits | 62 | 0 | 9 |
| Ramp floor exits | 24 | 0 | 8 |
| Pedestrian vertical continuity | 76 | 0 | 0 |
| Internal dead ends | 687 | 0 | 24 |
| Arc integrity | 15,542 | 0 | 0 |
| Exact duplicates | 15,542 | 0 | 0 |

There are 28 exterior origins. With the general profile and default scope,
27 doors reach 1,014 required spaces and leave 337 unreachable; one door reaches
2 and leaves 1,349 unreachable. Each origin also lists 166 excluded spaces.
Route percentages divide by the 1,351 required spaces, not the full inventory.
These are graph results, not scientific accuracy measurements; no independent
reference labels or invented F1 values are bundled.

Historical generator diagnostics include repairs and rejected connections;
they are displayed separately and are not added to current issue totals.

## Limits and reproducibility

The GeoPackage inventory can omit source IFC elements. Detecting such omissions
requires comparison with the original IFC. Continuity checks concern exported
vertical elements, not independently verified individual IfcStairFlight records.
Alternative physical passages are not duplicates by definition. The reduced
graph cannot prove geometrically shortest routes, clear widths, regulatory
accessibility, safety or evacuation performance without independent evidence.

`pnpm test:validation` exercises topology, directed reachability, profile
uncertainty, elevator cabins, exclusions and overrides, transit restrictions,
metrics, reference consistency and map layers. It also reads the real bundled
GeoPackage through the production loader. The checks run in the Pages workflow.
