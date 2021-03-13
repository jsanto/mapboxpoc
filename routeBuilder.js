
// rework route representation, separate definition/modification of route from mapbox interaction
// add direct property to waypoint and leg for serialization
// fix route hover showing when mousing over waypoint
// delete waypoint (from list or on click, mouseenter not reliable)
// stop "recording"
// snap waypoints to "grid"
// list of waypoints and toggle direct vs directions
// pull trail reports of trails hit
// get elevation data (w/ climb, desc stats)
// get distance data
// time estimate? no idea how reliable this would be
// custom style using studio vs outdoors-v11

window.addEventListener('load', function() {
    const InsertTypeEnum = Object.freeze({'insert': 0, 'replace': 1});

    const route = {
        waypoints: [],  // geoJSON point (w/ direct property)
        legs: [],       // geoJSON LineStrings TODO: add direct property
        directions: []  // whatever mapbox returns
    }

    let draggedLegIndex = null, activeWaypointIndex = null;
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
                drawWaypoints();
                
                let lineString = null;
                const start = route.waypoints[prevIndex].geometry.coordinates;
                const end = route.waypoints[index].geometry.coordinates;
                if (goingDirect) {
                    lineString = coordsToLineString([start, end], legIndex);
                } else {
                    // todo: pull directions for use?
                    const json = await getDirections(start, end);
                    const leg = json.routes[0];
                    lineString = coordsToLineString(leg.geometry.coordinates, legIndex);
                }

                route.legs.push(lineString);
                drawRoute(legIndex, lineString, InsertTypeEnum.insert, goingDirect);    
    
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

        map.on('mouseenter', 'waypoints', function(e) {
            console.log(e.point);
        });
        
        //capture shift press for direct routing
        document.addEventListener('keydown', function(e) {
            if (e.key == 'Shift') {
                goingDirect = true;
            }
        });
        
        document.addEventListener('keyup', function(e) {
            if (e.key == 'Shift') {
                goingDirect = false;
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

            //const index = 0;  // only one point on the routeDragger layer, overwrite
            //const point = coordsToWaypointPoint(coords, legId, false);
            //addWaypointToLayer('legSplitter', point, index, InsertTypeEnum.replace);
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
    
            let lineString = null;
            const start = route.waypoints[prevIndex].geometry.coordinates;
            const end   = route.waypoints[activeWaypointIndex].geometry.coordinates;
            if (legIsDirect) {
                lineString = coordsToLineString([start, end], backLegIndex);
            } else {
                // todo: pull directions for use?
                const json = await getDirections(start, end);
                const leg = json.routes[0];
                lineString = coordsToLineString(leg.geometry.coordinates, backLegIndex);
            }

            route.legs.splice(backLegIndex, InsertTypeEnum.replace, lineString);
            drawRoute(backLegIndex, lineString, InsertTypeEnum.replace, legIsDirect);  
        }
        
        // front leg
        if (activeWaypointIndex !== (route.waypoints.length - 1)) {
            const nextIndex = activeWaypointIndex + 1;
            const frontLegIndex = activeWaypointIndex;
            const legIsDirect = map.getFeatureState({source: 'route', id: frontLegIndex}).direct ?? false;
    
            let lineString = null;
            const start = route.waypoints[activeWaypointIndex].geometry.coordinates;
            const end = route.waypoints[nextIndex].geometry.coordinates;
            if (legIsDirect) {
                lineString = coordsToLineString([start, end], frontLegIndex);
            } else {
                // todo: pull directions for use?
                const json = await getDirections(start, end);
                const leg = json.routes[0];
                lineString = coordsToLineString(leg.geometry.coordinates, frontLegIndex);
            }

            route.legs.splice(frontLegIndex, InsertTypeEnum.replace, lineString);
            drawRoute(frontLegIndex, lineString, InsertTypeEnum.replace, legIsDirect); 
        }         
    
        map.off('mousemove', onWaypointMove);
    }
    
    function onRouteMove(e) {
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

        drawWaypoints();
    
        // leg splits will always have front and back
        const prevIndex = newWaypointIndex - 1;
        const nextIndex = newWaypointIndex + 1;
    
        // save which routes are currently direct starting at (draggedLegIndex + 1)
        const directLegs = [];
        const layer = map.getSource('route');
        const data = layer._data;
        for (let i = (draggedLegIndex + 1); i < data.features.length; i++) {
            const oldState = map.getFeatureState({source: 'route', id: i}).direct ?? false;
            if (oldState) {
                directLegs.push(i+1);
            }
        }
    
        const backLegIndex = draggedLegIndex;
        const frontLegIndex = draggedLegIndex + 1;
        const legIsDirect = map.getFeatureState({source: 'route', id: draggedLegIndex}).direct ?? false;
        
        let backLineString = null, frontLineString = null;
        if (legIsDirect) {
            backLineString = coordsToLineString([route.waypoints[prevIndex].geometry.coordinates, route.waypoints[newWaypointIndex].geometry.coordinates], backLegIndex);
            frontLineString = coordsToLineString([route.waypoints[newWaypointIndex].geometry.coordinates, route.waypoints[nextIndex].geometry.coordinates], frontLegIndex);
        } else {
            // todo: pull directions for use?
            const backDirections = getDirections(route.waypoints[prevIndex].geometry.coordinates, route.waypoints[newWaypointIndex].geometry.coordinates);
            const frontDirections = getDirections(route.waypoints[newWaypointIndex].geometry.coordinates, route.waypoints[nextIndex].geometry.coordinates);
            
            const[backJson, frontJson] = await Promise.all([backDirections, frontDirections]);
             
            const backLeg = backJson.routes[0];
            backLineString = coordsToLineString(backLeg.geometry.coordinates, backLegIndex);

            const frontLeg = frontJson.routes[0];
            frontLineString = coordsToLineString(frontLeg.geometry.coordinates, frontLegIndex);
        }

        route.legs.splice(backLegIndex, InsertTypeEnum.replace, backLineString);
        route.legs.splice(frontLegIndex, InsertTypeEnum.insert, frontLineString);
        drawRoute(backLegIndex, backLineString, InsertTypeEnum.replace, legIsDirect);
        drawRoute(frontLegIndex, frontLineString, InsertTypeEnum.insert, legIsDirect);
        
        // renumber and reset the rest of the legs
        const reindexStart = (draggedLegIndex + 2);
        for (let i = reindexStart; i < data.features.length; i++) {
            data.features[i].id = i;
    
            if (directLegs.includes(i)) {
                map.setFeatureState({source:'route', id: i}, {direct: true});
            } else {
                map.setFeatureState({source:'route', id: i}, {direct: false});
            }
        }
    
        // force refresh of layer to repaint
        layer.setData(data);
    
        // hide the router Dragger pip
        if (map.getLayer('legSplitter')) {
            map.setLayoutProperty('legSplitter', 'visibility', 'none');
        }
    
        map.off('mousemove', onRouteMove);
    }
    
    async function getDirections(start, end) {
        const url = 'https://api.mapbox.com/directions/v5/mapbox/cycling/' + start[0] + ',' + start[1] + ';' + end[0] + ',' + end[1] + '?steps=false&geometries=geojson&access_token=' + mapboxgl.accessToken;
        const response = await fetch(url);
    
        if (!response.ok) {
            console.log("Error fetching directions from MapBox.");
        } else {
            return await response.json();
        }
    }
    
    function drawRoute(legIndex, lineString, insertType, goDirect) {
        const layer = map.getSource('route');
        const data = layer._data;
    
        data.features.splice(legIndex, insertType, lineString); 
        map.setFeatureState({ source: 'route', id: legIndex }, { direct: goDirect });
    
        layer.setData(data);
    }

    // will this be too expensive if the waypoint array is huge? (define huge)
    function drawWaypoints() {
        const layer = map.getSource('waypoints');
        const data = layer._data;
        data.features = route.waypoints;

        layer.setData(data);
    }
 
    function coordsToLineString(route, id) {
        return {
            id: id,
            type: 'Feature',
            properties: {},
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