
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

    const waypoints = [];
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
            id: 'routeDragger',
            type: 'circle',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
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
        }, 'routeDragger');
    
        // click to add waypoints
        map.on('click', async function(e) {
            const coords = eventToCoords(e);
    
            // Add starting point to the map
            if (waypoints.length == 0) {
                const index = 0;
                const point = coordsToWaypointPoint(coords, index);
    
                waypoints.push(coords);
                addWaypointToLayer('waypoints', point, index, InsertTypeEnum.insert);
            } else {
                const index = waypoints.length;
                const legIndex = index - 1;
                const prevIndex = index - 1;
                const point = coordsToWaypointPoint(coords, index);    

                waypoints.push(coords);
                addWaypointToLayer('waypoints', point, index, InsertTypeEnum.insert);
                
                let lineString = null;
                if (goingDirect) {
                    lineString = coordsToLineString([waypoints[prevIndex], waypoints[index]], legIndex);
                } else {
                    // todo: pull directions for use?
                    const json = await getDirections(waypoints[prevIndex], waypoints[index]);
                    const route = json.routes[0];
                    const leg = route.geometry.coordinates;
                    lineString = coordsToLineString(leg, legIndex);
                }

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
            const legId = e.features[0].id;
            const index = 0;  // only one point on the routeDragger layer, overwrite
            const point = coordsToWaypointPoint(coords, legId);

            addWaypointToLayer('routeDragger', point, index, InsertTypeEnum.replace);
            map.setLayoutProperty('routeDragger', 'visibility', 'visible');
        });
    
        // remove waypoint viz
        map.on('mouseleave', 'route', function(e) {
            map.setLayoutProperty('routeDragger', 'visibility', 'none');
        });
    
        map.on('mousedown', 'routeDragger', function(e) {
            if (!isTopLayer(e, 'routeDragger')) { return false; }
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
        data.features[activeWaypointIndex] = coordsToWaypointPoint(coords, activeWaypointIndex);
        waypointLayer.setData(data);
    }
    
    async function onWaypointRelease(e) {
        const coords = eventToCoords(e)
    
        waypoints[activeWaypointIndex] = coords;
    
        // back leg
        if (activeWaypointIndex > 0) {
            const prevIndex = activeWaypointIndex - 1;
            const backLegIndex = activeWaypointIndex - 1;
            const legIsDirect = map.getFeatureState({source: 'route', id: backLegIndex}).direct ?? false;
    
            let lineString = null;
            if (legIsDirect) {
                lineString = coordsToLineString([waypoints[prevIndex], waypoints[activeWaypointIndex]], backLegIndex);
            } else {
                // todo: pull directions for use?
                const json = await getDirections(waypoints[prevIndex], waypoints[activeWaypointIndex]);
                const route = json.routes[0];
                const leg = route.geometry.coordinates;
                lineString = coordsToLineString(leg, backLegIndex);
            }

            drawRoute(backLegIndex, lineString, InsertTypeEnum.replace, legIsDirect);  
        }
        
        // front leg
        if (activeWaypointIndex !== (waypoints.length - 1)) {
            const nextIndex = activeWaypointIndex + 1;
            const frontLegIndex = activeWaypointIndex;
            const legIsDirect = map.getFeatureState({source: 'route', id: frontLegIndex}).direct ?? false;
    
            let lineString = null;
            if (legIsDirect) {
                lineString = coordsToLineString([waypoints[activeWaypointIndex], waypoints[nextIndex]], frontLegIndex);
            } else {
                // todo: pull directions for use?
                const json = await getDirections(waypoints[activeWaypointIndex], waypoints[nextIndex]);
                const route = json.routes[0];
                const leg = route.geometry.coordinates;
                lineString = coordsToLineString(leg, frontLegIndex);
            }

            drawRoute(frontLegIndex, lineString, InsertTypeEnum.replace, legIsDirect); 
        }         
    
        map.off('mousemove', onWaypointMove);
    }
    
    function onRouteMove(e) {
        const coords =  eventToCoords(e);
        const newWaypointLayer = map.getSource('routeDragger');
        const data = newWaypointLayer._data;
    
        data.features[0].geometry.coordinates = coords;
        newWaypointLayer.setData(data);
    }
    
    async function onRouteRelease(e) {
        const coords =  eventToCoords(e);
        const newWaypointIndex = draggedLegIndex + 1;
        const point = coordsToWaypointPoint(coords, newWaypointIndex);
    
        waypoints.splice(newWaypointIndex, InsertTypeEnum.insert, coords);
        addWaypointToLayer('waypoints', point, newWaypointIndex, InsertTypeEnum.insert);
    
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
            backLineString = coordsToLineString([waypoints[prevIndex], waypoints[newWaypointIndex]], backLegIndex);
            frontLineString = coordsToLineString([waypoints[newWaypointIndex], waypoints[nextIndex]], frontLegIndex);
        } else {
            // todo: pull directions for use?
            const backDirections = getDirections(waypoints[prevIndex], waypoints[newWaypointIndex]);
            const frontDirections = getDirections(waypoints[newWaypointIndex], waypoints[nextIndex]);
            
            const[backJson, frontJson] = await Promise.all([backDirections, frontDirections]);
             
            const backRoute = backJson.routes[0];
            const backLeg = backRoute.geometry.coordinates;
            backLineString = coordsToLineString(backLeg, backLegIndex);

            const frontRoute = frontJson.routes[0];
            const frontLeg = frontRoute.geometry.coordinates;
            frontLineString = coordsToLineString(frontLeg, frontLegIndex);
        }

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
        if (map.getLayer('routeDragger')) {
            map.setLayoutProperty('routeDragger', 'visibility', 'none');
        }
    
        map.off('mousemove', onRouteMove);
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
    
    function coordsToWaypointPoint(coords, id) {
        return {
            id: id,
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Point',
                coordinates: coords
            }
        }
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
    
    function addWaypointToLayer(layerName, point, index, insertType) {
        const layer = map.getSource(layerName);
        const data = layer._data;
        data.features.splice(index, insertType, point);
    
        // update ids after inserted waypoint
        if (insertType == InsertTypeEnum.insert) {
            for (let i = index+1; i < data.features.length; i++) {
                data.features[i].id = i;
            }
        }
    
        layer.setData(data);
    }
    
    function eventToCoords(e) {
        const coordsObj = e.lngLat;
        return Object.keys(coordsObj).map(function(key) {
            return coordsObj[key];
        });
    }
    
    function isTopLayer(e, me) {
        let f = map.queryRenderedFeatures(e.point, {layers: ['waypoints', 'route', 'routeDragger']});
        if (f.length > 0) {
            return f[0].layer.id == me;
        }
    }
});