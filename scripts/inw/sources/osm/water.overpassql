[out:json][timeout:300][bbox:47.385,-117.215,47.970,-116.345];
(
  nwr["natural"="water"];
  nwr["waterway"="riverbank"];
  nwr["landuse"="reservoir"];
  way["waterway"~"^(river|stream|canal|ditch|drain)$"];
);
out geom;
