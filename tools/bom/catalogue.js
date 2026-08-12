/* The material catalogue, read straight out of BOM.xlsx.
   c = category, n = the name exactly as it is written on the sheet, u = unit,
   t = the quantity that appeared most often across the 33 sites there, offered
   as the default when you add that line. None of it is a rule — every number
   is editable once it is on the BOM. */
window.BOM_CATALOGUE = [
  {c:"Brackets & Poles", n:"Antenna Circle Bracket", u:"set", t:1},
  {c:"Brackets & Poles", n:"Enclouser Mounting Pole", u:"nos", t:1},
  {c:"Brackets & Poles", n:"Antenna GSM Pole (3m)", u:"nos", t:3},
  {c:"Brackets & Poles", n:"LP RRU Bracket", u:"set", t:2},
  {c:"Brackets & Poles", n:"MW Bracket (HUB)", u:"nos", t:1},
  {c:"Brackets & Poles", n:"MW Bracket for Lamp Pole", u:"nos", t:1},
  {c:"Brackets & Poles", n:"Wi-Bas Bracket for Lamp Pole", u:"nos", t:1},
  {c:"GSM Antenna", n:"SXPWL4WH-16/18-65/65-IVT-R1_10P", u:"nos", t:3},
  {c:"GSM Antenna", n:"New RVV2NPX310.21(5P)", u:"nos"},
  {c:"GSM Antenna", n:"AT-COMM_RVV2H-6533B-R5_4.3-10F", u:"nos"},
  {c:"IDU with Jumper & Power Cable", n:"Huawei,Optix RTN905", u:"nos", t:2},
  {c:"IDU with Jumper & Power Cable", n:"Ericsson 2P IDU", u:"nos"},
  {c:"IDU with Jumper & Power Cable", n:"Ericsson 6P IDU", u:"nos"},
  {c:"IDU with Jumper & Power Cable", n:"Wi-Bas POE", u:"nos", t:2},
  {c:"MW Antenna", n:"0.3m (Huawei)", u:"nos"},
  {c:"MW Antenna", n:"0.6m (Huawei)", u:"nos", t:1},
  {c:"MW Antenna", n:"1.2m (Huawei)", u:"nos", t:1},
  {c:"MW Antenna", n:"0.3m (Ericsson)", u:"nos", t:2},
  {c:"MW Antenna", n:"0.6m (Ericsson)", u:"nos", t:2},
  {c:"MW Antenna", n:"0.3m (Wi-Bas)", u:"nos", t:1},
  {c:"MW Antenna", n:"0.6m (Wi-Bas)", u:"nos", t:1},
  {c:"ODU", n:"23G-H (Huawei)", u:"nos", t:1},
  {c:"ODU", n:"23G-L (Huawei)", u:"nos", t:1},
  {c:"ODU", n:"23G-H (Ericsson)", u:"nos", t:1},
  {c:"ODU", n:"23G-L (Ericsson)", u:"nos", t:1},
  {c:"ODU", n:"18G-H (Huawei)", u:"nos", t:1},
  {c:"ODU", n:"18G-L (Huawei)", u:"nos", t:1},
  {c:"ODU", n:"10G-H (Wi-Bas)", u:"nos", t:1},
  {c:"ODU", n:"10G-L (Wi-Bas)", u:"nos", t:1},
  {c:"RRU with Brackets & Power Connectors", n:"RRU5910 (GL900)", u:"nos", t:2},
  {c:"RRU with Brackets & Power Connectors", n:"Radio 2271 (GL900)", u:"nos", t:3},
  {c:"RRU with Brackets & Power Connectors", n:"RRU 4490 B1+B3 (L1800 + L2100)", u:"nos", t:2},
  {c:"RRU with Brackets & Power Connectors", n:"RRU 5909(L21)", u:"nos", t:3},
  {c:"RRU with Brackets & Power Connectors", n:"RRU5909 B3 (L18)", u:"nos", t:1},
  {c:"Connectors", n:"Y Connectors", u:"nos", t:2},
  {c:"Connectors", n:"IF Connectors", u:"nos", t:4},
  {c:"Connectors", n:"RJ45 Ethernet Connectors", u:"nos", t:8},
  {c:"SFP", n:"10G SFP", u:"nos", t:10},
  {c:"SFP", n:"1.25G TX SFP", u:"nos", t:4},
  {c:"Cables", n:"RRU Power Cable (Huawei)", u:"m", t:250},
  {c:"Cables", n:"RRU Power Cable (Ericsson)", u:"m", t:250},
  {c:"Cables", n:"RRU Power Cable (Enclauser Power)", u:"m"},
  {c:"Cables", n:"Fiber Cable (40m) - Huawei", u:"nos", t:5},
  {c:"Cables", n:"Fiber Cable (40m) - Ericsson", u:"nos", t:5},
  {c:"Cables", n:"Fiber Cable (70m)", u:"nos", t:1},
  {c:"Cables", n:"TX Fiber Pair (LC-LC)", u:"nos", t:1},
  {c:"Cables", n:"TX Fiber Pair (LC-SC)", u:"nos", t:2},
  {c:"Cables", n:"6mm Earth", u:"m", t:5},
  {c:"Cables", n:"16mm Earth", u:"m", t:15},
  {c:"Cables", n:"RET Cable", u:"nos"},
  {c:"Cables", n:"IF Cable", u:"m", t:80},
  {c:"Jumpers", n:"32-32 (3m)", u:"nos", t:6},
  {c:"Jumpers", n:"22-32 (3m)", u:"nos", t:6},
  {c:"Jumpers", n:"22-32 (5m)", u:"nos", t:12},
  {c:"Jumpers", n:"22-22 (5m)", u:"nos", t:12},
  {c:"BBU", n:"Huawei BBU3910 with UPEU, FAN Card & Power Cable", u:"nos", t:1},
  {c:"BBU", n:"BB6631 with Power Cables", u:"nos", t:1},
  {c:"BBU", n:"UMPTg2", u:"nos", t:1},
  {c:"BBU", n:"UBBPg1a", u:"nos", t:1},
  {c:"Ethernet", n:"Outdoor Ethernet", u:"m", t:100},
  {c:"Ethernet", n:"Readymade Ethernet (5m)", u:"nos", t:1},
  {c:"Local Purchased", n:"Ethernet Convertor", u:"nos", t:1},
  {c:"Local Purchased", n:"AC Relay with Base", u:"m"},
  {c:"Local Purchased", n:"2 Core Flexible Wire", u:"m"},
  {c:"Local Purchased", n:"6A Breacker", u:"nos"},
  {c:"Local Purchased", n:"Surge Arestor (MW)", u:"nos", t:4},
  {c:"Local Purchased", n:"Surge Arestor (Wi-Bas)", u:"nos", t:2},
  {c:"Local Purchased", n:"M6 Cage Nut and Screw", u:"nos", t:8},
  {c:"Local Purchased", n:"6mm Lug", u:"nos", t:8},
  {c:"Local Purchased", n:"16mm Lug", u:"nos", t:22},
  {c:"Local Purchased", n:"Silicon", u:"nos", t:1},
  {c:"Local Purchased", n:"White Tie", u:"nos", t:50},
  {c:"Local Purchased", n:"Black tie (L)", u:"nos", t:300},
  {c:"Local Purchased", n:"Steel Tie (1Ft, 300mm)", u:"nos", t:30},
  {c:"Local Purchased", n:"Colour Tapes (Blue/White/Red)", u:"each", t:1},
  {c:"Local Purchased", n:"Colour Tapes (Yellow)", u:"nos", t:1},
  {c:"Local Purchased", n:"Insulation Tape", u:"nos", t:10},
  {c:"Local Purchased", n:"Bonding", u:"nos", t:8},
  {c:"Local Purchased", n:"OutDoor Label", u:"nos", t:5},
  {c:"Local Purchased", n:"Feeder Engineering Label", u:"nos", t:5},
  {c:"Local Purchased", n:"Indoor Label Sheet", u:"nos", t:1},
  {c:"Local Purchased", n:"IF Earthing Kits", u:"nos", t:5},
  {c:"Local Purchased", n:"GI Flexible (20mm)", u:"m", t:40},
  {c:"Local Purchased", n:"PVC End Cap", u:"nos", t:1},
  {c:"Local Purchased", n:"Label Tie", u:"nos", t:100},
  {c:"Local Purchased", n:"Stainless Steel Wire Mesh", u:"ft", t:1},
  {c:"Clamp", n:"Clamp", u:"nos", t:10},
  {c:"Enclouser", n:"Enclouser", u:"nos", t:1},
  {c:"Enclouser", n:"Fiber 10m", u:"", t:1},
  {c:"DCDU", n:"DCDU 12B", u:"nos", t:1},
  {c:"DCDU", n:"Outdoor DC Power Box", u:"nos", t:1},
  {c:"DCDU", n:"UEIU", u:"nos"},
  {c:"DCDU", n:"Fiber(60M)Huawei", u:"nos"},
  {c:"DCDU", n:"32-22 Converter Connectors", u:"nos", t:18},
  {c:"DCDU", n:"Alarm Cable (For Ericsson Sites)", u:"nos", t:1}
];

/* ---- what goes with what ----
   Read off the same 33 sites rather than invented. Each rule says: when this
   is on the BOM, these usually are too, and how many. `per` multiplies by the
   sector count, `flat` is a fixed number, and `same` matches the quantity of
   the thing that triggered it.

   The jumper rules are not here — a jumper depends on which ports it is
   joining, so those are worked out in the page from the port types you set. */
window.BOM_COMPANIONS = [
  { when:/^SXPWL4WH|^New RVV2NPX|^AT-COMM_RVV2H/, label:'a GSM antenna', suggest:[
    {n:'Antenna GSM Pole (3m)', same:true, why:'one pole per antenna'},
    {n:'Antenna Circle Bracket', flat:1, why:'to mount them'},
    {n:'M6 Cage Nut and Screw', per:3, why:'3 per sector, roughly'}
  ]},
  { when:/^RRU|^Radio 2271/, label:'an RRU', suggest:[
    {n:'LP RRU Bracket', same:true, why:'one bracket per RRU'},
    {n:'RRU Power Cable (Huawei)', flat:250, why:'250m is the usual drum'},
    {n:'Fiber Cable (40m) - Huawei', same:true, why:'one run per RRU'},
    {n:'16mm Lug', per:6, why:'earthing at both ends'}
  ]},
  { when:/\(Huawei\)$|\(Ericsson\)$/, cat:'MW Antenna', label:'an MW antenna', suggest:[
    {n:'MW Bracket for Lamp Pole', same:true, why:'one per dish'},
    {n:'IF Cable', flat:80, why:'the run down the pole'},
    {n:'IF Connectors', flat:4, why:'two at each end'},
    {n:'IF Earthing Kits', flat:5, why:'along the IF run'},
    {n:'Surge Arestor (MW)', flat:4, why:'on the IF line'}
  ]},
  { when:/\(Wi-Bas\)$/, cat:'MW Antenna', label:'a Wi-Bas antenna', suggest:[
    {n:'Wi-Bas Bracket for Lamp Pole', same:true, why:'one per dish'},
    {n:'Wi-Bas POE', flat:2, why:'power over ethernet, both ends'},
    {n:'Outdoor Ethernet', flat:100, why:'the run down the pole'},
    {n:'Surge Arestor (Wi-Bas)', flat:2, why:'on the ethernet line'},
    {n:'RJ45 Ethernet Connectors', flat:8, why:'terminations'}
  ]},
  { when:/^Enclouser$/, label:'the enclosure', suggest:[
    {n:'Enclouser Mounting Pole', flat:1, why:'to hang it on'},
    {n:'DCDU 12B', flat:1, why:'power distribution inside'},
    {n:'Clamp', flat:10, why:'fixings'}
  ]}
];
