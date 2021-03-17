
// fix route hover showing when mousing over waypoint (isTopLayer is too slow for hover effects)
// toggle editting mode?
// snap waypoints to "grid"
// list of waypoints and toggle direct vs directions
// differentiate between "desitnation" waypoints and route/leg altering waypoints?
// pull trail reports of trails hit
// get elevation data (w/ climb, desc stats, compute for direct legs)
// get distance data (will need to compute distance for direct legs)
// time estimate? no idea how reliable this would be
// custom style using studio vs outdoors-v11

window.addEventListener('load', function() {
    const InsertTypeEnum = Object.freeze({'insert': 0, 'replace': 1});

    const route = {
        waypoints: [],  // geoJSON point (w/ direct property)
        legs: [],       // geoJSON LineStrings (w/ direct property)
        directions: []  // array of <li> with nav instructions per leg
    }

    let draggedLegIndex = null, activeWaypointIndex = null, deleteWaypointIndex = null;
    let goingDirect = false;
    
    mapboxgl.accessToken = 'pk.eyJ1IjoianNhbnRvZG9taW5nbyIsImEiOiJja2w0MGlwa2MwamVwMm5wZXYybnZ3OXZnIn0.8VeiKM_vrozoIHysipWWLw';
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/outdoors-v11',
        center: [-91.21711084364793, 43.811795561231094],
        zoom: 13,
        boxZoom: false // turn off box zoom so shift+click does direct routing
    });
    
    const canvas = map.getCanvasContainer();
    canvas.style.cursor = 'default';
    
    map.on('load', function() {
    
        // pre-create layers to ensure render order
        // waypoints
        map.addLayer({
            id: 'waypoints',
            type: 'circle',
            source: {
                type: 'geojson',
    
                data: {
                    type: 'FeatureCollection',
                    properties: {},
                    features: []
                }
            },
            paint: {
                'circle-radius': 4,
                'circle-color': '#fff',
                'circle-stroke-color': [
                    'case',
                    ['boolean', ['feature-state', 'direct'], false],
                    '#ccc',
                    '#000'
                ],
                'circle-stroke-width':2
            }
        });
    
        // route dragger (router splitter dot thing)
        // render layer before(under) waypoints so waypoint drags take precedence
        map.addLayer({
            id: 'legSplitter',
            type: 'circle',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        id: 0,
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'Point',
                            coordinates: [0,0]
                        }
                    }]
                }
            },
            paint: {
                'circle-radius': 4,
                'circle-color': '#fff',
                'circle-opacity': 0.75,
                'circle-stroke-color': '#000',
                'circle-stroke-width': 2, 
                'circle-stroke-opacity': 0.65
            }
        }, 'waypoints');
    
        // route legs
        map.addLayer({
            id: 'route',
            type: 'line',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    properties: {},
                    features: []
                }
            },
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'direct'], false],
                    '#555',
                    '#2d70f1'
                ],    
                'line-width': 5,
                'line-opacity': 0.75
            }
        }, 'legSplitter');
    
        // click to add waypoints
        map.on('click', async function(e) {
            const coords = eventToCoords(e);
    
            // Add starting point to the map
            if (route.waypoints.length == 0) {
                const index = 0;
                const point = coordsToWaypointPoint(coords, index, false);
    
                route.waypoints.push(point);

                drawWaypoints();
            } else {
                const index = route.waypoints.length;
                const legIndex = index - 1;
                const prevIndex = index - 1;
                const point = coordsToWaypointPoint(coords, index, goingDirect);    

                route.waypoints.push(point);
                
                let lineString = null, legSteps = [];
                const start = route.waypoints[prevIndex].geometry.coordinates;
                const end = route.waypoints[index].geometry.coordinates;

                if (goingDirect) {
                    lineString = coordsToLineString([start, end], legIndex, goingDirect);
                    legSteps.push('<li>Travel direct to next waypoint.</li>');
                } else {
                    const json = await getDirections(start, end);
                    const leg = json.routes[0];
                    lineString = coordsToLineString(leg.geometry.coordinates, legIndex, goingDirect);

                    let steps = leg.legs[0].steps;
                    for (let i = 0; i < (steps.length - 1); i++) {
                        legSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
                    }
                }

                route.legs.push(lineString);
                route.directions.push(legSteps.join(''));

                drawDirections();
                drawWaypoints();
                drawRoute();     
            }
        });
    
    
        // waypoint events
        map.on('mousedown', 'waypoints', function(e) {
            if (!isTopLayer(e, 'waypoints')) { return false; }
    
            // stop map drag, just the point please.
            e.preventDefault();
            activeWaypointIndex = e.features[0].id;
    
            map.on('mousemove', onWaypointMove);
            map.once('mouseup', onWaypointRelease);
        });

        // track waypoint hovers for deletion
        map.on('mouseenter', 'waypoints', function(e) {
            deleteWaypointIndex = e.features[0].id;
        });

        map.on('mouseleave', 'waypoints', function(e) {
            deleteWaypointIndex = null;
        });

        // keyboard events
        document.addEventListener('keydown', function(e) {
            if (e.key == 'Shift') {
                goingDirect = true;
            }
        });
        
        document.addEventListener('keyup', async function(e) {
            if (e.key == 'Shift') {
                goingDirect = false;
            }

            if ((e.key == 'Delete' || e.key == 'Backspace') && deleteWaypointIndex != null) {
                const lastLegIndex = route.legs.length - 1;
                const backLegIndex = deleteWaypointIndex - 1;
                const frontLegIndex = deleteWaypointIndex;
                const direct = ((deleteWaypointIndex + 1) < route.waypoints.length) 
                    ? route.waypoints[(deleteWaypointIndex + 1)].properties.direct
                    : false;

                // remove and reset following IDs
                route.waypoints.splice(deleteWaypointIndex, 1);
                for (let i = deleteWaypointIndex; i < route.waypoints.length; i++) {
                    route.waypoints[i].id = i;
                }

                // removed head
                if (deleteWaypointIndex == 0) {
                    route.legs.splice(frontLegIndex, 1);
                    route.directions.splice(frontLegIndex, 1);

                // removed tail
                } else if (deleteWaypointIndex == route.waypoints.length) {
                    route.legs.splice(backLegIndex, 1);
                    route.directions.splice(backLegIndex, 1);

                // removed a middle waypoint    
                } else {
                    const start = route.waypoints[(deleteWaypointIndex - 1)].geometry.coordinates;
                    const end = route.waypoints[deleteWaypointIndex].geometry.coordinates;
                    let lineString = null, legSteps = [];

                    if (direct) {
                        lineString = coordsToLineString([start, end], backLegIndex, direct);
                        legSteps.push('<li>Travel direct to next waypoint.</li>');
                    } else {
                        // todo: pull directions for use?
                        const json = await getDirections(start, end);
                        const leg = json.routes[0];
                        lineString = coordsToLineString(leg.geometry.coordinates, backLegIndex, direct);

                        let steps = leg.legs[0].steps;
                        for (let i = 0; i < (steps.length - 1); i++) {
                            legSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
                        }
                    }

                    // remove back and front at the same time when inserting this lineString
                    route.legs.splice(backLegIndex, 2, lineString); 
                    route.directions.splice(backLegIndex, 2, legSteps.join(''));
                }
 
                // reset following leg IDs
                for (let i = frontLegIndex; i < route.legs.length; i++) {
                    route.legs[i].id = i;
                }

                drawDirections();
                drawWaypoints();
                drawRoute();
            }
        });
    
        // draw route change dot
        // TODO: add "drag to change route" popup
        map.on('mousemove', 'route', function(e) {
            const coords = eventToCoords(e);
            const layer = map.getSource('legSplitter');
            const data = layer._data;

            data.features[0].id = e.features[0].id; // legId being dragged
            data.features[0].geometry.coordinates = coords;
            layer.setData(data);
            map.setLayoutProperty('legSplitter', 'visibility', 'visible');
        });
    
        // remove waypoint viz
        map.on('mouseleave', 'route', function(e) {
            map.setLayoutProperty('legSplitter', 'visibility', 'none');
        });
    
        map.on('mousedown', 'legSplitter', function(e) {
            if (!isTopLayer(e, 'legSplitter')) { return false; }
            e.preventDefault();
            draggedLegIndex = e.features[0].id;
    
            map.on('mousemove', onRouteMove);
            map.once('mouseup', onRouteRelease);
        });
    });
    
    function onWaypointMove(e) {
        const coords = eventToCoords(e);
        const waypointLayer = map.getSource('waypoints');
        const data = waypointLayer._data;

        data.features[activeWaypointIndex] = coordsToWaypointPoint(coords, activeWaypointIndex, goingDirect);
        waypointLayer.setData(data);
    }
    
    async function onWaypointRelease(e) {
        const coords = eventToCoords(e)
    
        route.waypoints[activeWaypointIndex] = coordsToWaypointPoint(coords, activeWaypointIndex, goingDirect);
    
        // back leg
        if (activeWaypointIndex > 0) {
            const prevIndex = activeWaypointIndex - 1;
            const backLegIndex = activeWaypointIndex - 1;
            const legIsDirect = map.getFeatureState({source: 'route', id: backLegIndex}).direct ?? false;
    
            let lineString = null, legSteps = [];
            const start = route.waypoints[prevIndex].geometry.coordinates;
            const end   = route.waypoints[activeWaypointIndex].geometry.coordinates;

            if (legIsDirect) {
                lineString = coordsToLineString([start, end], backLegIndex, legIsDirect);
                legSteps.push('<li>Travel direct to next waypoint.</li>');
            } else {
                const json = await getDirections(start, end);
                const leg = json.routes[0];
                lineString = coordsToLineString(leg.geometry.coordinates, backLegIndex, legIsDirect);

                let steps = leg.legs[0].steps;
                for (let i = 0; i < (steps.length - 1); i++) {
                    legSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
                }
            }

            route.legs.splice(backLegIndex, InsertTypeEnum.replace, lineString); 
            route.directions.splice(backLegIndex, InsertTypeEnum.replace, legSteps.join(''));
        }
        
        // front leg
        if (activeWaypointIndex !== (route.waypoints.length - 1)) {
            const nextIndex = activeWaypointIndex + 1;
            const frontLegIndex = activeWaypointIndex;
            const legIsDirect = map.getFeatureState({source: 'route', id: frontLegIndex}).direct ?? false;
    
            let lineString = null, legSteps = [];
            const start = route.waypoints[activeWaypointIndex].geometry.coordinates;
            const end = route.waypoints[nextIndex].geometry.coordinates;
            if (legIsDirect) {
                lineString = coordsToLineString([start, end], frontLegIndex, legIsDirect);
                legSteps.push('<li>Travel direct to next waypoint.</li>');
            } else {
                const json = await getDirections(start, end);
                const leg = json.routes[0];
                lineString = coordsToLineString(leg.geometry.coordinates, frontLegIndex, legIsDirect);

                let steps = leg.legs[0].steps;
                for (let i = 0; i < (steps.length - 1); i++) {
                    legSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
                }
            }

            route.legs.splice(frontLegIndex, InsertTypeEnum.replace, lineString);
            route.directions.splice(frontLegIndex, InsertTypeEnum.replace, legSteps.join(''));
        }         
    
        drawDirections();
        drawRoute(); 
        map.off('mousemove', onWaypointMove);
    }
    
    function onRouteMove(e) {
        map.setLayoutProperty('legSplitter', 'visibility', 'visible');
        const coords =  eventToCoords(e);
        const layer = map.getSource('legSplitter');
        const data = layer._data;
    
        data.features[0].geometry.coordinates = coords;
        layer.setData(data);
    }
    
    async function onRouteRelease(e) {
        const coords =  eventToCoords(e);
        const newWaypointIndex = draggedLegIndex + 1;
        const point = coordsToWaypointPoint(coords, newWaypointIndex, goingDirect);
    
        // insert and reset following IDs
        route.waypoints.splice(newWaypointIndex, InsertTypeEnum.insert, point);    
        for (let i = newWaypointIndex + 1; i < route.waypoints.length; i++) {
            route.waypoints[i].id = i;
        }


        // leg splits will always have front and back
        const prevIndex = newWaypointIndex - 1;
        const nextIndex = newWaypointIndex + 1;
        const backLegIndex = draggedLegIndex;
        const frontLegIndex = draggedLegIndex + 1;
        const legIsDirect = route.legs[draggedLegIndex].properties.direct ?? false;
        
        let backLineString = null, frontLineString = null;
        let backLegSteps = [], frontLegSteps = [];
        if (legIsDirect) {
            backLineString = coordsToLineString([route.waypoints[prevIndex].geometry.coordinates, route.waypoints[newWaypointIndex].geometry.coordinates], backLegIndex, legIsDirect);
            frontLineString = coordsToLineString([route.waypoints[newWaypointIndex].geometry.coordinates, route.waypoints[nextIndex].geometry.coordinates], frontLegIndex, legIsDirect);
            legSteps.push('<li>Travel direct to next waypoint.</li>');
            legSteps.push('<li>Travel direct to next waypoint.</li>');
        } else {
            const backDirections = getDirections(route.waypoints[prevIndex].geometry.coordinates, route.waypoints[newWaypointIndex].geometry.coordinates);
            const frontDirections = getDirections(route.waypoints[newWaypointIndex].geometry.coordinates, route.waypoints[nextIndex].geometry.coordinates);
            
            const[backJson, frontJson] = await Promise.all([backDirections, frontDirections]);
             
            const backLeg = backJson.routes[0];
            backLineString = coordsToLineString(backLeg.geometry.coordinates, backLegIndex, legIsDirect);
            let steps = backLeg.legs[0].steps;
            for (let i = 0; i < (steps.length - 1); i++) {
                backLegSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
            }

            const frontLeg = frontJson.routes[0];
            frontLineString = coordsToLineString(frontLeg.geometry.coordinates, frontLegIndex, legIsDirect);
            steps = frontLeg.legs[0].steps;
            for (let i = 0; i < (steps.length - 1); i++) {
                frontLegSteps.push('<li>' + steps[i].maneuver.instruction + '</li>');
            }
        }

        route.legs.splice(backLegIndex, InsertTypeEnum.replace, backLineString, frontLineString);
        route.directions.splice(backLegIndex, InsertTypeEnum.replace, backLegSteps.join(''), frontLegSteps.join(''));
        
        // reset following leg IDs
        const reindexStart = (draggedLegIndex + 2);
        for (let i = reindexStart; i < route.legs.length; i++) {
            route.legs[i].id = i;
        }

        drawDirections();
        drawWaypoints();
        drawRoute();
        map.setLayoutProperty('legSplitter', 'visibility', 'none');    
        map.off('mousemove', onRouteMove);
    }
    
    async function getDirections(start, end) {
        const url = 'https://api.mapbox.com/directions/v5/mapbox/cycling/' + start[0] + ',' + start[1] + ';' + end[0] + ',' + end[1] + '?steps=true&geometries=geojson&access_token=' + mapboxgl.accessToken;
        const response = await fetch(url);
    
        if (!response.ok) {
            console.log("Error fetching directions from MapBox.");
        } else {
            return await response.json();
        }
    }

    function drawDirections() {
        const instructions = document.getElementById('instructions');
        
        if (route.directions.length == 0) {
            instructions.innerHTML = '<p>Click to start route.</p>';
        } else {
            instructions.innerHTML = '<h3>Route Directions</h3><ol>' + route.directions.join('') + '</ol>';
        }
    }
    
    function drawRoute() {
        const layer = map.getSource('route');
        const data = layer._data;
        data.features = route.legs;
        route.legs.forEach( function(leg) {
            map.setFeatureState({source:'route', id: leg.id}, { direct: leg.properties.direct });
        });
    
        layer.setData(data);
    }

    // will this be too expensive if the waypoint array is huge? (define huge)
    function drawWaypoints() {
        const layer = map.getSource('waypoints');
        const data = layer._data;
        data.features = route.waypoints;

        layer.setData(data);
    }
 
    function coordsToLineString(route, id, direct) {
        return {
            id: id,
            type: 'Feature',
            properties: { direct: direct },
            geometry: {
                type: 'LineString',
                coordinates: route
            }
        }
    }
    
    function coordsToWaypointPoint(coords, id, direct) {
        return {
            id: id,
            type: 'Feature',
            properties: { direct: direct },
            geometry: {
                type: 'Point',
                coordinates: coords
            }
        }
    }

    function eventToCoords(e) {
        const coordsObj = e.lngLat;
        return Object.keys(coordsObj).map(function(key) {
            return coordsObj[key];
        });
    }
    
    function isTopLayer(e, me) {
        let f = map.queryRenderedFeatures(e.point, {layers: ['waypoints', 'route', 'legSplitter']});
        if (f.length > 0) {
            return f[0].layer.id == me;
        }
    }
});