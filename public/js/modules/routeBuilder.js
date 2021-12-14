// CSRFTK should this be here?  required for ajax calls...
import * as GeoJSON from './geoJSON.js';

const InsertTypeEnum = Object.freeze({'insert': 0, 'replace': 1});

let routeList = [];
let route = {};

async function appendWaypoint(coords, goDirect) {
    const wpIndex = route.data.waypoints.length;
    const newPoint = GeoJSON.coordsToWaypoint(coords, wpIndex, goDirect);

    // guard first waypoint
    if (wpIndex == 0) {
        route.data.waypoints.push(newPoint);
        return;
    }

    const legId = wpIndex - 1;
    const prevIndex = wpIndex - 1;
    const prevCoords = route.data.waypoints[prevIndex].geometry.coordinates;
    const nextCoords = coords;
    let [newLeg, newDirections] = await processDirections(prevCoords, nextCoords, legId, goDirect);

    route.data.legs.push(newLeg);
    route.data.directions.push(newDirections);
}

async function deleteWaypoint(deleteWaypointIndex) {
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
}

async function moveWaypoint(coords, movedWaypointIndex, goDirect) {
    route.data.waypoints[movedWaypointIndex] = GeoJSON.coordsToWaypoint(coords, movedWaypointIndex, goDirect);
    
    // back leg
    if (movedWaypointIndex > 0) {
        const prevIndex = movedWaypointIndex - 1;
        const backLegIndex = movedWaypointIndex - 1;
        const legIsDirect = route.data.legs[backLegIndex].properties.direct ?? false;

        const start = route.data.waypoints[prevIndex].geometry.coordinates;
        const end   = route.data.waypoints[movedWaypointIndex].geometry.coordinates;

        let [lineString, legSteps] = await processDirections(start, end, backLegIndex, legIsDirect);

        route.data.legs.splice(backLegIndex, InsertTypeEnum.replace, lineString); 
        route.data.directions.splice(backLegIndex, InsertTypeEnum.replace, legSteps);
    }
    
    // front leg
    if (movedWaypointIndex !== (route.data.waypoints.length - 1)) {
        const nextIndex = movedWaypointIndex + 1;
        const frontLegIndex = movedWaypointIndex;
        const legIsDirect = route.data.legs[frontLegIndex].properties.direct ?? false;

        const start = route.data.waypoints[movedWaypointIndex].geometry.coordinates;
        const end = route.data.waypoints[nextIndex].geometry.coordinates;
        
        let [lineString, legSteps] = await processDirections(start, end, frontLegIndex, legIsDirect);
        
        route.data.legs.splice(frontLegIndex, InsertTypeEnum.replace, lineString);
        route.data.directions.splice(frontLegIndex, InsertTypeEnum.replace, legSteps);
    }  
}

async function insertWaypointInLeg(coords, draggedLegId, goDirect) {
    const newWaypointIndex = draggedLegId + 1;
    const point = GeoJSON.coordsToWaypoint(coords, newWaypointIndex, goDirect);
    
    // insert and reset following IDs
    route.data.waypoints.splice(newWaypointIndex, InsertTypeEnum.insert, point);    
    for (let i = newWaypointIndex + 1; i < route.data.waypoints.length; i++) {
        route.data.waypoints[i].id = i;
    }

    // leg splits will always have front and back
    const prevIndex = newWaypointIndex - 1;
    const nextIndex = newWaypointIndex + 1;
    const backLegIndex = draggedLegId;
    const frontLegIndex = draggedLegId + 1;
    const legIsDirect = route.data.legs[draggedLegId].properties.direct ?? false;
    
    const backStart = route.data.waypoints[prevIndex].geometry.coordinates;
    const backEnd = route.data.waypoints[newWaypointIndex].geometry.coordinates;
    let [backLineString, backLegSteps] = await processDirections(backStart, backEnd, backLegIndex, legIsDirect);

    const frontStart = route.data.waypoints[newWaypointIndex].geometry.coordinates;
    const frontEnd = route.data.waypoints[nextIndex].geometry.coordinates;
    let [frontLineString, frontLegSteps] = await processDirections(frontStart, frontEnd, frontLegIndex, legIsDirect);

    route.data.legs.splice(backLegIndex, InsertTypeEnum.replace, backLineString, frontLineString);
    route.data.directions.splice(backLegIndex, InsertTypeEnum.replace, backLegSteps, frontLegSteps);
    
    // reset following leg IDs
    const reindexStart = (draggedLegId + 2);
    for (let i = reindexStart; i < route.data.legs.length; i++) {
        route.data.legs[i].id = i;
    }
}

function initRoute() {
    route = {
        id: 0, // default for new routes
        name: '',
        data: {
            waypoints: [],  // geoJSON point (w/ direct property)
            legs: [],       // geoJSON LineStrings (w/ direct property)
            directions: []  // array of custom step objects { instruction, type }
        }
    }
}

async function getRouteList() {
    const csrftk = document.getElementById('csrftk');
    const url = 'list?' + (new URLSearchParams({ 'csrftk': csrftk.value })).toString(); 
    const response = await fetch(url, {
        method: 'GET',
        cache: 'no-cache'
    }) 

    if (!response.ok) {
        console.log('Error loading list of routes.');
    }

    const retval = await response.json();
    csrftk.value = retval.csrftk;
    routeList = retval.routes; 
}

async function loadRoute(id) {
    const csrftk = document.getElementById('csrftk');
    const url = 'load?' + (new URLSearchParams({ 'csrftk': csrftk.value, 'id': id })).toString(); 
    const response = await fetch(url, {
        method: 'GET',
        cache: 'no-cache'
    });

    if (!response.ok) {
        console.log('Error loading route id: ' + id);
    } 

    const retval = await response.json();
    csrftk.value = retval.csrftk;
    route = retval.route;
}

async function saveRoute() {
    const csrftk = document.getElementById('csrftk');
    const data = new URLSearchParams({ 'csrftk': csrftk.value, 'route': JSON.stringify(route) });

    const response = await fetch('save', {
        method: 'POST',
        cache: 'no-cache',
        body: data
    });

    if (!response.ok) {
        console.log('Error saving route.');
        return false;
    } 

    const retval = await response.json();
    csrftk.value = retval.csrftk;
    route = retval.route;  // will have inserted id now
    return true;
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
        lineString = GeoJSON.coordsToLeg([start, end], legIndex, direct);
        legSteps.push({
            instruction: `Travel direct to waypoint #${readableWaypointID}.`,
            type: 'direct',
        });
    } else {
        const json = await getDirections(start, end);
        const leg = json.routes[0];
        lineString = GeoJSON.coordsToLeg(leg.geometry.coordinates, legIndex, direct);

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


export { 
    routeList, route, 
    appendWaypoint, deleteWaypoint, moveWaypoint, insertWaypointInLeg,
    initRoute, 
    getRouteList, loadRoute, saveRoute 
};