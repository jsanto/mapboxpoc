# MapBox Route Builder POC

Modern browsers only at the moment.  No polyfills for old browser support.

## Intent

I was getting some unexpected behavior with the current TrailForks route builders (compared to my experience with Google Maps), so I'm using this project as a way to understand the challenges in implementing such a tool as well as for learning the MapBox GL library.

## As the crow flies

Specifically, I wanted a way to "go off network" for some legs of the route building.  This can allow routes to cut through parking lots, or for trails right next to a road where you want to turn, but OpenStreetMaps (or whatever dataset) doesn't have an intersection where you need it.

So I added the ability to hold [Shift] when placing waypoints to skip the routing network and just draw a direct line.