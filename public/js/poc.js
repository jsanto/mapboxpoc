// implement undo/redo?
// toggle editting mode?
// snap waypoints to "grid"
// list of waypoints and toggle direct vs directions
// i feel like there might be a way to refactor RouteBuilder.route.data.waytpoints manipulation in a way like how drawDirections was
// differentiate between "desitnation" waypoints and route/leg altering waypoints? (supported ride feed stations vs just picking the trails for the ride)
// google maps style points only where fork/descision/turn is?  (is that possible with mapbox data?)
// pull trail reports of trails hit
// get elevation data (w/ climb, desc stats, compute for direct legs)
// get distance data (will need to compute distance for direct legs)
// time estimate? no idea how reliable this would be
// custom style using studio vs outdoors-v11
// going to need some structure to this code base soon... (cleaner separation between route obj handling, MapBox interaction, and UI stuff?)
// warn if potentially destroying route when clicking "create new route"?

import * as RouteBuilder from './modules/routeBuilder.js';
import * as GeoJSON from './modules/geoJSON.js';

window.addEventListener('load', function() {
    RouteBuilder.initRoute(); // init blank route

    let draggedLegIndex = null, activeWaypointIndex = null, deleteWaypointIndex = null;
    let goingDirect = false;
    
    mapboxgl.accessToken = 'pk.eyJ1IjoianNhbnRvZG9taW5nbyIsImEiOiJja2wzd3hvYWUwbjA0MnVwN21taWFucGFoIn0.O8zaceFeVKWCo60a1XRgGw';
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
            await RouteBuilder.appendWaypoint(coords, goingDirect);

            drawDirections();
            drawWaypoints();
            drawRoute();  
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

            const hoverTip = document.getElementById('hoverTip');
            hoverTip.style.display = 'none';
        });

        map.on('mousemove', 'waypoints', function(e) {
            drawHoverTip(e, 'Drag to move waypoint.<br>[Delete] to delete waypoint.', '2.5em');
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
                await RouteBuilder.deleteWaypoint(deleteWaypointIndex);

                drawDirections();
                drawWaypoints();
                drawRoute();
            }
        });
    
        // draw route change dot
        map.on('mousemove', 'route', function(e) {
            if (!isTopLayer(e, 'route')) { return false; }

            const coords = eventToCoords(e);
            const layer = map.getSource('legSplitter');
            const data = layer._data;

            data.features[0].id = e.features[0].id; // legId being dragged
            data.features[0].geometry.coordinates = coords;
            layer.setData(data);
            map.setLayoutProperty('legSplitter', 'visibility', 'visible');

            drawHoverTip(e, 'Drag to change RouteBuilder.route.', '1em');
        });

        map.on('mousemove', 'legSplitter', function(e) {
            if (!isTopLayer(e, 'legSplitter')) { return false; }

            const coords = eventToCoords(e);
            const layer = map.getSource('legSplitter');
            const data = layer._data;

            data.features[0].id = e.features[0].id; // legId being dragged
            data.features[0].geometry.coordinates = coords;
            layer.setData(data);
            map.setLayoutProperty('legSplitter', 'visibility', 'visible');

            drawHoverTip(e, 'Drag to change RouteBuilder.route.', '1em');
        });

        map.on('mouseleave', 'legSplitter', function(e) { 
            map.setLayoutProperty('legSplitter', 'visibility', 'none');  
            
            const hoverTip = document.getElementById('hoverTip');
            hoverTip.style.display = 'none';
        });

        // remove waypoint viz
        map.on('mouseleave', 'route', function(e) {
            map.setLayoutProperty('legSplitter', 'visibility', 'none');  
            
            const hoverTip = document.getElementById('hoverTip');
            hoverTip.style.display = 'none';
        });

        map.on('mousedown', 'legSplitter', function(e) {
            if (!isTopLayer(e, 'legSplitter')) { return false; }
            e.preventDefault();
            draggedLegIndex = e.features[0].id;
    
            map.on('mousemove', onRouteMove);
            map.once('mouseup', function(e) { onRouteRelease(e); });
        });
    });
    
    function onWaypointMove(e) {
        const coords = eventToCoords(e);
        const waypointLayer = map.getSource('waypoints');
        const data = waypointLayer._data;

        data.features[activeWaypointIndex] = GeoJSON.coordsToWaypoint(coords, activeWaypointIndex, goingDirect);
        waypointLayer.setData(data);
    }
    
    async function onWaypointRelease(e) {
        const coords = eventToCoords(e)
        await RouteBuilder.moveWaypoint(coords, activeWaypointIndex, goingDirect);
    
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
        await RouteBuilder.insertWaypointInLeg(coords, draggedLegIndex, goingDirect);

        drawDirections();
        drawWaypoints();
        drawRoute();

        map.setLayoutProperty('legSplitter', 'visibility', 'none');    
        map.off('mousemove', onRouteMove);
    }

    function drawDirections() {
        const instructions = document.getElementById('instructions');

        // build table, filtering out arrival steps mid route
        const flatDirections = [];
        for (let i = 0; i < RouteBuilder.route.data.directions.length; i++) {
            for (let j = 0; j < RouteBuilder.route.data.directions[i].length; j++) {
                let step = RouteBuilder.route.data.directions[i][j];
                
                if (step.type == 'arrive' && i != (RouteBuilder.route.data.directions.length - 1)) {
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

        if (RouteBuilder.route.data.directions.length == 0) {
            instructions.innerHTML = '<h3>Directions</h3><p>Click to add waypoints and create a RouteBuilder.route.</p>';
        } else {
            instructions.innerHTML = '<h3>Directions</h3><ol>' + flatDirections.join('') + '</ol>';
        }
    }

    function drawRoute() {
        const layer = map.getSource('route');
        const data = layer._data;
        data.features = RouteBuilder.route.data.legs;
        RouteBuilder.route.data.legs.forEach( function(leg) {
            map.setFeatureState({source:'route', id: leg.id}, { direct: leg.properties.direct });
        });
    
        layer.setData(data);
    }

    // will this be too expensive if the waypoint array is huge? (define huge)
    function drawWaypoints() {
        const layer = map.getSource('waypoints');
        const data = layer._data;
        data.features = RouteBuilder.route.data.waypoints;

        layer.setData(data);
    }

    function drawHoverTip(e, msg, height) {
        const hoverTip = document.getElementById('hoverTip');
        hoverTip.innerHTML = msg;
        hoverTip.style.height = height;
        
        hoverTip.style.display = 'block';
        hoverTip.style.top = 0;
        hoverTip.style.right = 0;
        hoverTip.style.bottom = 0;
        hoverTip.style.left = 0;

        if (window.innerWidth - e.point.x < 200) {
            hoverTip.style.left = `${(e.point.x - 130)}px`;
        } else {
            hoverTip.style.left =  `${e.point.x + 10}px`;
        }

        if (window.innerHeight - e.point.y < 50) {
            hoverTip.style.top = `${e.point.y - 20}px`;
        } else {
            hoverTip.style.top = `${e.point.y + 10}px`;
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
        RouteBuilder.initRoute();
    
        const name = document.getElementById('name');
        name.value = '';
    
        drawDirections();
        drawWaypoints();
        drawRoute();
    });

    const nameInput = document.getElementById('name');
    nameInput.addEventListener('input', function(e) {
        RouteBuilder.route.name = this.value;
    });

    const saveButton = document.getElementById('save');
    saveButton.addEventListener('click', function(e) {
        const savemsg = document.getElementById('savemsg');
        if (RouteBuilder.saveRoute()) {
            savemsg.style.transition = 'unset';
            savemsg.style.opacity = 1;
            
            savemsg.innerHTML = 'SAVED!';
            savemsg.style.color = 'green';
            savemsg.style.transition = 'opacity 10s';
            savemsg.style.opacity = 0;
        } else {
            savemsg.style.transition = 'unset';
            savemsg.style.opacity = 1;
            
            savemsg.innerHTML = 'error saving';
            savemsg.style.color = 'red';
            savemsg.style.transition = 'opacity 10s';
            savemsg.style.opacity = 0;    
        }
    });

    const rlContainer = document.getElementById('routeList');
    const loadButton = document.getElementById('load');
    loadButton.addEventListener('click', async function(e){
        await RouteBuilder.getRouteList();
        
        let routes = '<h3>Load saved route:</h3>';
        for (let i=0; i < RouteBuilder.routeList.length; i++) {
            routes += `<div class='route' id='${RouteBuilder.routeList[i].id}'>${RouteBuilder.routeList[i].name}</div>`
        }
        rlContainer.innerHTML = routes;
        rlContainer.style.display = 'block';
    });

    rlContainer.addEventListener('click', async function(e) {
        if (e.target.matches('.route')) {
            await RouteBuilder.loadRoute(e.target.id);
            RouteBuilder.route.data = JSON.parse(RouteBuilder.route.data);
            nameInput.value = RouteBuilder.route.name;

            drawDirections();
            drawWaypoints();
            drawRoute();

            if (RouteBuilder.route.data.waypoints.length > 0) {
                map.flyTo({center: RouteBuilder.route.data.waypoints[0].geometry.coordinates, zoom: 13});
            }

            rlContainer.style.display = 'none';
        }
    });
});