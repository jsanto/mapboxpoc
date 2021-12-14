function coordsToLeg(coords, id, direct) {
    return {
        id: id,
        type: 'Feature',
        properties: { direct: direct },
        geometry: {
            type: 'LineString',
            coordinates: coords
        }
    }
}

function coordsToWaypoint(coords, id, direct) {
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
 

export { coordsToLeg, coordsToWaypoint }