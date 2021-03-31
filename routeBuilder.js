// fix route hover showing when mousing over waypoint (isTopLayer is too slow for hover effects)
// toggle editting mode?
// snap waypoints to "grid"
// list of waypoints and toggle direct vs directions
// i feel like there might be a way to refactor route.data.waytpoints manipulation in a way like how drawDirections was
// differentiate between "desitnation" waypoints and route/leg altering waypoints? (supported ride feed stations vs just picking the trails for the ride)
// google maps style points only where fork/descision/turn is?  (is that possible with mapbox data?)
// pull trail reports of trails hit
// get elevation data (w/ climb, desc stats, compute for direct legs)
// get distance data (will need to compute distance for direct legs)
// time estimate? no idea how reliable this would be
// custom style using studio vs outdoors-v11
// going to need some structure to this code base soon... (cleaner separation between route obj handling, MapBox interaction, and UI stuff?)
// warn if potentially destroying route when clicking "create new route"?

let routeList = [];
let route = {
    id: 0, // default for new routes
    name: '',
    data: {
        waypoints: [],  // geoJSON point (w/ direct property)
        legs: [],       // geoJSON LineStrings (w/ direct property)
        directions: []  // array of custom step objects { instruction, type }
    }
}

window.addEventListener('load', function() {
    const InsertTypeEnum = Object.freeze({'insert': 0, 'replace': 1});

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
            if (route.data.waypoints.length == 0) {
                const index = 0;
                const point = coordsToWaypointPoint(coords, index, false);   

                route.data.waypoints.push(point);

                drawWaypoints();
            } else {
                const index = route.data.waypoints.length;
                const point = coordsToWaypointPoint(coords, index, goingDirect);   

                route.data.waypoints.push(point);
                
                const legIndex = index - 1;
                const prevIndex = index - 1;
                const start = route.data.waypoints[prevIndex].geometry.coordinates;
                const end = route.data.waypoints[index].geometry.coordinates;

                let [lineString, legSteps] = await processDirections(start, end, legIndex, goingDirect);
                
                route.data.legs.push(lineString);
                route.data.directions.push(legSteps);

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
                const lastLegIndex = route.data.legs.length - 1;
                const backLegIndex = deleteWaypointIndex - 1;
                const frontLegIndex = deleteWaypointIndex;
                const direct = ((deleteWaypointIndex + 1) < route.data.waypoints.length) 
                    ? route.data.waypoints[(deleteWaypointIndex + 1)].properties.direct
                    : false;

                // remove and reset following IDs
                route.data.waypoints.splice(deleteWaypointIndex, 1);
                for (let i = deleteWaypointIndex; i < route.data.waypoints.length; i++) {
                    route.data.waypoints[i].id = i;
                }

                // removed head
                if (deleteWaypointIndex == 0) {
                    route.data.legs.splice(frontLegIndex, 1);
                    route.data.directions.splice(frontLegIndex, 1);

                // removed tail
                } else if (deleteWaypointIndex == route.data.waypoints.length) {
                    route.data.legs.splice(backLegIndex, 1);
                    route.data.directions.splice(backLegIndex, 1);

                // removed a middle waypoint    
                } else {
                    const start = route.data.waypoints[(deleteWaypointIndex - 1)].geometry.coordinates;
                    const end = route.data.waypoints[deleteWaypointIndex].geometry.coordinates;
                    
                    let [lineString, legSteps] = await processDirections(start, end, backLegIndex, direct);

                    // remove back and front at the same time when inserting this lineString
                    route.data.legs.splice(backLegIndex, 2, lineString); 
                    route.data.directions.splice(backLegIndex, 2, legSteps);
                }
 
                // reset following leg IDs
                for (let i = frontLegIndex; i < route.data.legs.length; i++) {
                    route.data.legs[i].id = i;
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
    
        route.data.waypoints[activeWaypointIndex] = coordsToWaypointPoint(coords, activeWaypointIndex, goingDirect);
    
        // back leg
        if (activeWaypointIndex > 0) {
            const prevIndex = activeWaypointIndex - 1;
            const backLegIndex = activeWaypointIndex - 1;
            const legIsDirect = map.getFeatureState({source: 'route', id: backLegIndex}).direct ?? false;
    
            const start = route.data.waypoints[prevIndex].geometry.coordinates;
            const end   = route.data.waypoints[activeWaypointIndex].geometry.coordinates;

            let [lineString, legSteps] = await processDirections(start, end, backLegIndex, legIsDirect);

            route.data.legs.splice(backLegIndex, InsertTypeEnum.replace, lineString); 
            route.data.directions.splice(backLegIndex, InsertTypeEnum.replace, legSteps);
        }
        
        // front leg
        if (activeWaypointIndex !== (route.data.waypoints.length - 1)) {
            const nextIndex = activeWaypointIndex + 1;
            const frontLegIndex = activeWaypointIndex;
            const legIsDirect = map.getFeatureState({source: 'route', id: frontLegIndex}).direct ?? false;
    
            const start = route.data.waypoints[activeWaypointIndex].geometry.coordinates;
            const end = route.data.waypoints[nextIndex].geometry.coordinates;
            
            let [lineString, legSteps] = await processDirections(start, end, frontLegIndex, legIsDirect);
            
            route.data.legs.splice(frontLegIndex, InsertTypeEnum.replace, lineString);
            route.data.directions.splice(frontLegIndex, InsertTypeEnum.replace, legSteps);
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
        route.data.waypoints.splice(newWaypointIndex, InsertTypeEnum.insert, point);    
        for (let i = newWaypointIndex + 1; i < route.data.waypoints.length; i++) {
            route.data.waypoints[i].id = i;
        }

        // leg splits will always have front and back
        const prevIndex = newWaypointIndex - 1;
        const nextIndex = newWaypointIndex + 1;
        const backLegIndex = draggedLegIndex;
        const frontLegIndex = draggedLegIndex + 1;
        const legIsDirect = route.data.legs[draggedLegIndex].properties.direct ?? false;
        
        const backStart = route.data.waypoints[prevIndex].geometry.coordinates;
        const backEnd = route.data.waypoints[newWaypointIndex].geometry.coordinates;
        let [backLineString, backLegSteps] = await processDirections(backStart, backEnd, backLegIndex, legIsDirect);

        const frontStart = route.data.waypoints[newWaypointIndex].geometry.coordinates;
        const frontEnd = route.data.waypoints[nextIndex].geometry.coordinates;
        let [frontLineString, frontLegSteps] = await processDirections(frontStart, frontEnd, frontLegIndex, legIsDirect);

        route.data.legs.splice(backLegIndex, InsertTypeEnum.replace, backLineString, frontLineString);
        route.data.directions.splice(backLegIndex, InsertTypeEnum.replace, backLegSteps, frontLegSteps);
        
        // reset following leg IDs
        const reindexStart = (draggedLegIndex + 2);
        for (let i = reindexStart; i < route.data.legs.length; i++) {
            route.data.legs[i].id = i;
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

    async function processDirections(start, end, legIndex, direct) {
        let lineString = null, legSteps = [];

        if (direct) {
            const readableWaypointID = legIndex + 2;
            lineString = coordsToLineString([start, end], legIndex, direct);
            legSteps.push({
                instruction: `Travel direct to waypoint #${readableWaypointID}.`,
                type: 'direct',
            });
        } else {
            const json = await getDirections(start, end);
            const leg = json.routes[0];
            lineString = coordsToLineString(leg.geometry.coordinates, legIndex, direct);

            const steps = leg.legs[0].steps;
            for (let i = 0; i < steps.length; i++) {
                legSteps.push({ 
                    instruction: steps[i].maneuver.instruction,
                    type: steps[i].maneuver.type,
                });
            }
        }

        return [lineString, legSteps];
    }

    function drawDirections() {
        const instructions = document.getElementById('instructions');

        // build table, filtering out arrival steps mid route
        const flatDirections = [];
        for (let i = 0; i < route.data.directions.length; i++) {
            for (let j = 0; j < route.data.directions[i].length; j++) {
                let step = route.data.directions[i][j];
                
                if (step.type == 'arrive' && i != (route.data.directions.length - 1)) {
                    // don't use arrival steps mid route
                } else {
                    let text = `<li>${step.instruction}</li>`;

                    // don't repeat identical instructions
                    // TODO: accumulate distance and duration
                    if (text != flatDirections[(flatDirections.length - 1)])
                    {
                        flatDirections.push(text);
                    }
                }
            }
        }

        if (route.data.directions.length == 0) {
            instructions.innerHTML = '<h3>Directions</h3><p>Click to add waypoints and create a route.</p>';
        } else {
            instructions.innerHTML = '<h3>Directions</h3><ol>' + flatDirections.join('') + '</ol>';
        }
    }

    function drawRoute() {
        const layer = map.getSource('route');
        const data = layer._data;
        data.features = route.data.legs;
        route.data.legs.forEach( function(leg) {
            map.setFeatureState({source:'route', id: leg.id}, { direct: leg.properties.direct });
        });
    
        layer.setData(data);
    }

    // will this be too expensive if the waypoint array is huge? (define huge)
    function drawWaypoints() {
        const layer = map.getSource('waypoints');
        const data = layer._data;
        data.features = route.data.waypoints;

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

    const newButton = document.getElementById('new');
    newButton.addEventListener('click', function(e) {
        route = {
            id: 0, // default for new routes
            name: '',
            data: {
                waypoints: [],  // geoJSON point (w/ direct property)
                legs: [],       // geoJSON LineStrings (w/ direct property)
                directions: []  // array of custom step objects { instruction, type }
            }
        };
    
        const name = document.getElementById('name');
        name.value = '';
    
        drawDirections();
        drawWaypoints();
        drawRoute();
    });

    const nameInput = document.getElementById('name');
    nameInput.addEventListener('input', function(e) {
        route.name = this.value;
    });

    const saveButton = document.getElementById('save');
    saveButton.addEventListener('click', function(e) {
        save();
    });

    const rlContainer = document.getElementById('routeList');
    const loadButton = document.getElementById('load');
    loadButton.addEventListener('click', async function(e){
        await getRoutes();
        
        let routes = '<h3>Load saved route:</h3>';
        for (let i=0; i < routeList.length; i++) {
            routes += `<div class='route' id='${routeList[i].id}'>${routeList[i].name}</div>`
        }
        rlContainer.innerHTML = routes;
        rlContainer.style.display = 'block';
    });

    rlContainer.addEventListener('click', async function(e) {
        if (e.target.matches('.route')) {
            await load(e.target.id);
            route.data = JSON.parse(route.data);
            nameInput.value = route.name;

            drawDirections();
            drawWaypoints();
            drawRoute();

            rlContainer.style.display = 'none';
        }
    });
});

async function save() {
    const csrftk = document.getElementById('csrftk');
    const data = new URLSearchParams({ 'csrftk': csrftk.value, 'route': JSON.stringify(route) });

    const response = await fetch('save_route.php', {
        method: 'POST',
        cache: 'no-cache',
        body: data
    });

    if (!response.ok) {
        console.log('Error saving route.');
    } else {
        const retval = await response.json();
        csrftk.value = retval.csrftk;
        route = retval.route;  // will have inserted id now
    }
}

async function load(id) {
    const csrftk = document.getElementById('csrftk');
    const url = 'load_route.php?' + (new URLSearchParams({ 'csrftk': csrftk.value, 'id': id })).toString(); 
    const response = await fetch(url, {
        method: 'GET',
        cache: 'no-cache'
    });

    if (!response.ok) {
        console.log('Error loading route id: ' + id);
    } else {
        const retval = await response.json();
        csrftk.value = retval.csrftk;
        route = retval.route;
    }
}

// returns array of route objects
async function getRoutes() {
    const csrftk = document.getElementById('csrftk');
    const url = 'get_routes.php?' + (new URLSearchParams({ 'csrftk': csrftk.value })).toString(); 
    const response = await fetch(url, {
        method: 'GET',
        cache: 'no-cache'
    }) 

    if (!response.ok) {
        console.log('Error loading list of routes.');
    } else {
        const retval = await response.json();
        csrftk.value = retval.csrftk;
        routeList = retval.routes;
    }
}