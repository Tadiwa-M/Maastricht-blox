// Exploration content: landmark plaques and golden studs (docs/guide/15-exploration.md).
//
// Positions are Unity metres (x east, z north) for the city world with originRD
// [174700, 314000] (x = RD_x - 174700, z = RD_y - 314000); y is the ground height (three.js
// metres, k = 0 = 30 m NAP) found when the spot was picked, used until the streamed city
// answers groundHeight. Other worlds shift by their own originRD (shiftTo in logic.js).
//
// How the spots were picked: each landmark's anchor is its OSM/BAG feature centroid in the
// world's features.json; the plaque stands on the nearest open street cell (the walkable low
// ground in front of the building, a clear 1.5 m around it), searched in the built city's
// chunks and islands. Studs went through the same search around hand-picked interesting spots.
// History lines are kept short, factual and conservative.

export const DATA_ORIGIN_RD = [174700, 314000];

/** { id, name, text, at: [x, z], y, anchor: [x, z] (the building the plaque faces) } */
export const LANDMARKS = [
  { id: 'stadhuis', name: 'Stadhuis', at: [1689.8, 3989.8], y: 18.6, anchor: [1720, 3988],
    text: 'The city hall on the Markt, built 1659–1664 to a design by Pieter Post. Its two front stairs are said to stand for the two powers that then shared rule over Maastricht.' },
  { id: 'minckelers', name: 'Minckelers statue', at: [1646.8, 4033.8], y: 17.8, anchor: [1647, 4040],
    text: 'Jan Pieter Minckelers (1748–1824), born in Maastricht, was a pioneer of lighting with coal gas. His statue has stood on the Markt since 1904.' },
  { id: 'servaas', name: 'Sint-Servaasbasiliek', at: [1470.2, 3724.8], y: 22.4, anchor: [1420, 3710],
    text: 'Built over the grave of Saint Servatius, an early bishop who died in the 4th century. Much of the present church dates from the 11th and 12th centuries.' },
  { id: 'sintjan', name: 'Sint-Janskerk', at: [1495.2, 3664.8], y: 21.0, anchor: [1455, 3660],
    text: 'A Gothic church from the 14th century, beside the Sint-Servaas on the Vrijthof. It has been a Protestant church since the 17th century; its tall tower is painted red.' },
  { id: 'spaansgouvernement', name: 'Spaans Gouvernement', at: [1539.8, 3684.8], y: 20.6, anchor: [1538, 3656],
    text: 'A 16th-century house on the Vrijthof, named after the Spanish Habsburg rulers of that time. Today it is home to the Museum aan het Vrijthof.' },
  { id: 'dinghuis', name: 'Dinghuis', at: [1794.8, 3825.8], y: 19.8, anchor: [1813, 3828],
    text: 'A late-medieval court house at the head of the Grote Staat; a "ding" was a court session. It now houses the city\'s visitor centre.' },
  { id: 'dominicanen', name: 'Boekhandel Dominicanen', at: [1592.8, 3843.8], y: 20.2, anchor: [1620, 3852],
    text: 'A bookshop inside the Gothic church of the Dominican friars, begun in the 13th century. After centuries of other uses it opened as a bookshop in 2006.' },
  { id: 'olv', name: 'Onze-Lieve-Vrouwebasiliek', at: [1847.2, 3557.2], y: 19.0, anchor: [1885, 3556],
    text: 'A Romanesque basilica with a fortress-like west front, parts of it from the 11th century. A side chapel holds the statue of Our Lady, Star of the Sea.' },
  { id: 'stokstraat', name: 'Stokstraat', at: [1925.8, 3565.8], y: 19.4, anchor: [1926, 3566],
    text: 'One of the oldest streets of the city, close to where the Romans bridged the Maas. Restored from the 1950s on, it is now a street of fashion shops.' },
  { id: 'helpoort', name: 'Helpoort', at: [1938.8, 3364.8], y: 17.8, anchor: [1940, 3346],
    text: 'Built around 1230 in the first city wall, it is the oldest surviving city gate in the Netherlands.' },
  { id: 'bisschopsmolen', name: 'Bisschopsmolen', at: [1822.2, 3426.8], y: 17.6, anchor: [1824, 3420],
    text: 'A water mill on a branch of the Jeker in the Jekerkwartier. A mill has stood here since the Middle Ages, and it still grinds flour for the bakery next door.' },
  { id: 'olvwal', name: 'Onze Lieve Vrouwewal', at: [1952.2, 3469.8], y: 17.8, anchor: [1960, 3470],
    text: 'A stretch of the medieval city wall along the Maas, with old cannons on the rampart. Maastricht kept extending its walls for centuries as a fortress city.' },
  { id: 'servaasbrug', name: 'Sint Servaasbrug', at: [1958.2, 3789.2], y: 15.8, anchor: [2044, 3777],
    text: 'A stone arch bridge over the Maas from the late 13th century, one of the oldest bridges in the Netherlands. Its eastern end was rebuilt in the 20th century for shipping.' },
  { id: 'hogebrug', name: 'Hoge Brug', at: [2216.8, 3420.8], y: 15.0, anchor: [2130, 3420],
    text: 'A bridge for walkers and cyclists over the Maas, opened in 2003, linking the old centre with the Céramique district.' },
  { id: 'ceramique', name: 'Centre Céramique', at: [2364.8, 3414.8], y: 20.2, anchor: [2394, 3391],
    text: 'Library, city archive and exhibition space on Plein 1992, opened in 1999. The district is named after the Société Céramique pottery works that stood here.' },
  { id: 'bonnefanten', name: 'Bonnefanten', at: [2421.8, 2999.2], y: 20.0, anchor: [2427, 3006],
    text: 'The museum of old and contemporary art in a building by the architect Aldo Rossi, opened in 1995. Its domed tower is a landmark on the Maas.' },
  { id: 'station', name: 'Station Maastricht', at: [2679.8, 3789.8], y: 17.6, anchor: [2725, 3803],
    text: 'The station building dates from 1913. Trains run from here across the Netherlands and over the border to Liège and Aachen.' },
  { id: 'kazematten', name: 'Kazematten', at: [949.8, 3106.2], y: 25.6, anchor: [947, 3104],
    text: 'Bomb-proof passages dug inside the fortifications between the 16th and 19th centuries, so defenders could move and shelter underground. Tours start by the Waldeck bastion.' },
  { id: 'fortsintpieter', name: 'Fort Sint Pieter', at: [1204.2, 2326.2], y: 54.0, anchor: [1210, 2282],
    text: 'Built in 1701–1702 on the slope of the Sint-Pietersberg to guard the city from the south.' },
  { id: 'enci', name: 'ENCI quarry', at: [1557.2, 744.2], y: 8.6, anchor: [1564, 743],
    text: 'For most of a century the ENCI cement works quarried marl from the Sint-Pietersberg here. Quarrying stopped in 2018 and the pit is becoming a nature area.' },
  { id: 'lichtenberg', name: 'Ruïne Lichtenberg', at: [1963.2, 797.2], y: 75.4, anchor: [1967, 802],
    text: 'The remaining tower of the medieval castle of Lichtenberg, on the edge of the Sint-Pietersberg.' },
  { id: 'zonneberg', name: 'Grotten Zonneberg', at: [1965.2, 1141.8], y: 52.4, anchor: [1965, 1142],
    text: 'Kilometres of tunnels left by centuries of marl quarrying under the Sint-Pietersberg. Townspeople sheltered in them during the Second World War.' },
  { id: 'kruisheren', name: 'Kruisherenklooster', at: [1183.8, 3635.8], y: 29.2, anchor: [1180, 3679],
    text: 'The Gothic monastery and church of the Crosiers, from the 15th century, now turned into a hotel.' },
  { id: 'stadspark', name: 'Stadspark', at: [1979.8, 3292.2], y: 17.6, anchor: [1979, 3286],
    text: 'A park laid out in the 19th century along the Jeker and the old southern city walls, with remains of the fortifications.' },
];

/** { id, at: [x, z], y, hint (where it is, shown once found) } */
export const STUDS = [
  { id: 'markt-west', at: [1623.8, 3999.8], y: 17.8, hint: 'Markt' },
  { id: 'drieemmercour', at: [1834.8, 4081.2], y: 18.6, hint: 'Mosae Forum courtyard' },
  { id: 'kwadevliegencour', at: [1779.8, 3965.8], y: 17.8, hint: 'Kwadevliegencour' },
  { id: 'vrijthof', at: [1500.2, 3759.8], y: 21.8, hint: 'Vrijthof' },
  { id: 'servaasklooster', at: [1385.8, 3656.8], y: 27.2, hint: 'Sint Servaasklooster' },
  { id: 'kommel', at: [1261.8, 3790.8], y: 24.8, hint: 'Kommel' },
  { id: 'amorsplein', at: [1675.8, 3725.8], y: 20.0, hint: 'Sint Amorsplein' },
  { id: 'kersenmarkt', at: [1817.8, 3747.8], y: 20.4, hint: 'Kersenmarkt' },
  { id: 'thermen', at: [1892.8, 3633.8], y: 20.4, hint: 'Op de Thermen' },
  { id: 'het-bat', at: [1965.8, 3521.8], y: 17.6, hint: 'Het Bat' },
  { id: 'maasboulevard', at: [2002.2, 3539.8], y: 18.0, hint: 'Maasboulevard' },
  { id: 'servaasbrug-deck', at: [2044.0, 3777.0], y: 20.0, hint: 'On the Sint Servaasbrug' },
  { id: 'hogebrug-deck', at: [2130.0, 3420.0], y: 18.6, hint: 'On the Hoge Brug' },
  { id: 'stadspark-s', at: [1940.2, 3219.8], y: 17.8, hint: 'Stadspark' },
  { id: 'nolenspark', at: [1821.8, 3157.8], y: 18.2, hint: 'Monseigneur Nolenspark' },
  { id: 'aldenhofpark', at: [1223.2, 3174.2], y: 31.8, hint: 'Aldenhofpark' },
  { id: 'tapijntuin', at: [1303.8, 3113.8], y: 20.6, hint: 'Tapijntuin' },
  { id: 'waldeckpark', at: [997.8, 3107.8], y: 25.2, hint: 'Waldeckpark' },
  { id: 'jekerpark', at: [893.8, 2735.8], y: 20.0, hint: 'Jekerpark' },
  { id: 'jekerdal', at: [741.8, 2078.8], y: 21.4, hint: 'Jekerdal' },
  { id: 'jekermolen', at: [559.8, 2114.2], y: 21.2, hint: 'Jekermolenbrug' },
  { id: 'fort-glacis', at: [1247.8, 2307.8], y: 54.0, hint: 'Below Fort Sint Pieter' },
  { id: 'pieter-boven', at: [1844.2, 1746.8], y: 34.0, hint: 'Sint Pieter Boven' },
  { id: 'torentjes', at: [1915.2, 1802.8], y: 26.2, hint: 'Huis De Torentjes' },
  { id: 'lourdesgrot', at: [1932.2, 1502.2], y: 37.0, hint: 'Lourdes grotto' },
  { id: 'de-kluis', at: [1864.2, 1215.8], y: 53.8, hint: 'Cave dwelling De Kluis' },
  { id: 'hoeve-lichtenberg', at: [1415.2, 1235.8], y: 77.4, hint: 'Hoeve Lichtenberg' },
  { id: 'groeve-view', at: [1602.2, 759.2], y: 6.8, hint: 'ENCI quarry' },
  { id: 'lichtenberg-ruin', at: [1971.2, 789.8], y: 75.6, hint: 'Ruïne Lichtenberg' },
  { id: 'frontenpark', at: [1057.2, 4393.8], y: 22.8, hint: 'Frontenpark' },
  { id: 'hoge-fronten', at: [846.2, 4186.8], y: 33.2, hint: 'Hoge Fronten' },
  { id: 'bassin', at: [1759.8, 4444.8], y: 12.8, hint: 'Bassin' },
  { id: 'lumiere', at: [1699.8, 4575.8], y: 13.6, hint: 'Sphinx quarter' },
  { id: 'oeverwal', at: [2164.2, 3935.8], y: 17.8, hint: 'Oeverwal, Wyck' },
  { id: 'maaspunt', at: [2235.8, 3385.8], y: 14.8, hint: 'Maaspunt' },
  { id: 'bonnefanten-kade', at: [2404.2, 2949.8], y: 18.8, hint: 'By the Bonnefanten' },
  { id: 'pieterskade', at: [2031.2, 2797.8], y: 18.0, hint: 'Sint Pieterskade' },
  { id: 'randwyck-park', at: [2941.2, 2125.8], y: 16.6, hint: 'Randwyck Park' },
  { id: 'leeuwenpark', at: [3209.8, 3965.8], y: 17.6, hint: 'Leeuwenpark' },
  { id: 'polvertoren', at: [1229.8, 3407.8], y: 27.8, hint: 'Polvertorenplein' },
  { id: 'minderbroedersberg', at: [1383.8, 3511.8], y: 27.0, hint: 'Minderbroedersberg' },
  { id: 'lindenkruis', at: [1311.8, 4317.8], y: 18.2, hint: 'Lindenkruis' },
];

/**
 * Cosmetic rewards for golden studs. The character creator does not read these yet: the
 * explore module announces them (window.__bloxExplore.unlocked(), 'blox:unlock' events) for
 * the creator to offer (docs/guide/15-exploration.md, "Unlocks").
 */
export const UNLOCKS = [
  { id: 'gold-hat', studs: 10, name: 'Golden cap colour' },
  { id: 'gold-top', studs: 25, name: 'Golden jacket colour' },
  { id: 'gold-all', studs: STUDS.length, name: 'Golden shoes and bag' },
];
