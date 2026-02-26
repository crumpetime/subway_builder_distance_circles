(function () {
	const api = window.SubwayBuilderAPI;
	var useStationCatchmentRadii = true;
	const r = api.utils.React;
	var radiusDistanceOverride = 0;

	const FILL_COLOUR_DARK = "#86e08c2c";
	const OUTLINE_COLOUR_DARK = "rgb(75, 119, 74)";
	const FILL_COLOUR_LIGHT = "#154d432c";
	const OUTLINE_COLOUR_LIGHT = "rgb(4, 15, 13)";
	
	
	function translateTrackTypeNames(trType) {
		if (trType === "heavy-metro" || !api.stations.getStationType(trType)) return "standard"; //assume using standard station if none registered
	//	if (trType === "s-train") return "S-tog";
	//	if (trType === "regional") return "Lokaltog";
	//	if (trType === "intercity") return "Fjerntog";
	//	if (trType === "tram") return "Letbane";
		return trType;
	}

	function generateGeoJSONCoords(sides, radiusMeters, lon, lat) { // make the funny circles
		const coords = new Array(sides + 1);

		const R = 6378137;
		const degToRad = Math.PI / 180;
		const radToDeg = 180 / Math.PI;

		const lat0 = lat * degToRad;
		const lon0 = lon * degToRad;

		const sinLat0 = Math.sin(lat0);
		const cosLat0 = Math.cos(lat0);

		const angularDistance = radiusMeters / R;
		const sinAD = Math.sin(angularDistance);
		const cosAD = Math.cos(angularDistance);

		const bearings = getBearings(sides);

		for (let i = 0; i < sides; i++) {
			const { sinB, cosB } = bearings[i];

			const latRad = Math.asin(
				sinLat0 * cosAD + cosLat0 * sinAD * cosB
			);

			const lonRad =
				lon0 +
				Math.atan2(
					sinB * sinAD * cosLat0,
					cosAD - sinLat0 * Math.sin(latRad)
				);

			coords[i] = [lonRad * radToDeg, latRad * radToDeg];
		}

		coords[sides] = coords[0];
		return coords;
	}

	function preGenerateCircles(sides,refLon,refLat,min,max){
		let circs = new Map();
		for(let j = min; j < max; j++){
			circs.set(j*60,generateGeoJSONCoords(sides,j*60,refLon,refLat));
		}
		return circs;
	}


	let circleCache = new Map();
	let cLon = 0;
	let cLat = 0;

	function translateGeoJSONCoords(radius, lon, lat, refLon, refLat){
		//console.log(refLat);
		//console.log(refLon);
		let refCoords = circleCache.get(radius);
		//console.log(circleCache);
		let newCoords = new Array();
		let offsetLon = lon - refLon;
		let offsetLat = lat - refLat;
		for (let i = 0; i < refCoords.length; i++){
			newCoords.push([refCoords[i][0] + offsetLon, refCoords[i][1] + offsetLat]);
		}
		return newCoords;
	}


	function generateGeoJsonFeatures(radius, lon, lat, refLon, refLat) { // wrapper function for geojson coords
		console.log(radius);
		return {
			type: "Feature",
			geometry: {
				type: "Polygon",
				coordinates: [translateGeoJSONCoords(radius, lon, lat, refLon, refLat)]
			}
		};
	}


	function precalculateStationRadii() { //precalculate radii for all station types
		let radii = new Map();
		let stationTypes = api.stations.getStationTypes();

		for (const key of Object.keys(stationTypes)) {
			let stnType = stationTypes[key];
			let walkDistMult = stnType.walkDistMultiplier ?? 1;
			let catchMult = stnType.catchmentMultiplier ?? 1;
			radii.set(key, ((catchMult * 30) * 60) * walkDistMult);
		}

		return radii;
	}

	const bearingCache = new Map(); //i have no idea what this does but copilot said it was faster
	function getBearings(sides) {
		if (bearingCache.has(sides)) return bearingCache.get(sides);

		const arr = new Array(sides);
		const step = (2 * Math.PI) / sides;

		for (let i = 0; i < sides; i++) {
			const b = i * step;
			arr[i] = { sinB: Math.sin(b), cosB: Math.cos(b) };
		}

		bearingCache.set(sides, arr);
		return arr;
	}

	
	var cachedFeatureCollection = {  //container for geojsons when they're not being updated
		type: "FeatureCollection",
		features: []
	};

	
	function rebuildgeoJSONs() { //rebuild geojsons
		let stations = api.gameState.getStations();
		let tracks = api.gameState.getTracks();
		const radii = precalculateStationRadii();

		let features = [];

		for (let stn of stations) {
			let track = tracks.find(t => t.id === stn.trackIds[0]);
			if (!track) continue;

			const type = translateTrackTypeNames(track.trackType);
			let radius = radii.get(type);
			if (!useStationCatchmentRadii){
				radius = radiusDistanceOverride * 60;
			}
			if (!radius) continue;
			//console.log(radius);
			const [lon, lat] = stn.coords;
			//features.push(generateGeoJsonFeatures(64, radius, lon, lat));
			features.push(generateGeoJsonFeatures(radius,lon,lat,cLon,cLat));
		}

		let fc = {
			type: "FeatureCollection",
			features
		};

		// Push to map source if it exists
		const map = api.utils.getMap();
		if (map && map.getSource("catchments")) {
			map.getSource("catchments").setData(fc);
		}

		return features;
	}
	
	function rebuildCatchments(){
		cachedFeatureCollection.features = rebuildgeoJSONs();
	}

	api.hooks.onPauseChanged(() => {
		console.log(Object.keys(api.stations.getStationTypes()));
		console.log(api.trains.getTrainTypes());
		console.log(api.stations.getStationType("Tube 2024 (LDN)"));
	})
	
	let toolbarButtonReference = null;
	
	function setButtonState(state){ //state 0 = show nothing, state 1 = show outline, state 2 = show circle
		if (!toolbarButtonReference){toolbarButtonReference = document.querySelector("[title='Change catchment area visibility']")};
		let st = state;
		if (st == 0){
			toolbarButtonReference.firstChild.setHTMLUnsafe('<circle cx="12" cy="12" r="10" fill="white"></circle>');
			st++;
		}
		else if (st == 1){
			toolbarButtonReference.firstChild.setHTMLUnsafe('<circle cx="12" cy="12" r="10"></circle>');
			st++;
		}
		else if (st == 2){
			toolbarButtonReference.firstChild.setHTMLUnsafe('<circle cx="12" cy="12" r="10" fill="black"></circle>');
			st = 0;
		}
		//console.log(st);
		return st;
	}

	function queryVisibility(state){
		return !(state == 0);
	}

	let viewState = 0;
	

	api.hooks.onMapReady((map) => {
		let showFill = true;
		cLon = map.getCenter().lng;
		cLat = map.getCenter().lat;
		circleCache = preGenerateCircles(64,cLon,cLat,1,60);
		rebuildCatchments();
		const trains = api.stations.getStationTypes();

		let visible = true;


		api.ui.addSlider('top-bar', {
			id: 'com.muffintime.distancecircles.distslider',
			label: 'Station Radius',
			min: 0,
			max: 60,
			step: 1,
			defaultValue: 0,
			showValue: true,
			showFill: true,
			unit: 'minutes',
			onChange: ((value) => {
				radiusDistanceOverride = value;
				if(value === 0) useStationCatchmentRadii = true; else useStationCatchmentRadii = false;
				cachedFeatureCollection.features = [];
			}),
		});


		
		api.ui.addToolbarButton({ //add the toggle
			id: "com.muffintime.distancecircles.visibility",
			tooltip: "Change catchment area visibility",
			icon: "XCircle",
			onClick: () => (
			//	viewState = setButtonState(viewState),
			//	visible = queryVisibility(viewState)
			visible = !visible
			),
			isActive: () => visible
		});

		api.ui.addToolbarButton({ //add another button
			id: "com.muffintime.distancecircles.painttype",
			tooltip: "Change catchment area view style",
			icon: "XCircle",
			onClick: () => (
			//	viewState = setButtonState(viewState),
			//	visible = queryVisibility(viewState)
			showFill = !showFill
			),
			isActive: () => showFill && visible
		});

		//document.querySelector("[title='Change catchment area visibility']").setHTMLUnsafe('<circle cx="12" cy="12" r="10" fill="white"></circle>'); //overwrite symbol
		//toolbarButtonReference = document.querySelector("[title='Change catchment area visibility']"); //scuffed af
		//console.log(toolbarButtonReference);

		// initialise catchment source
		if (!map.getSource("catchments")){
			api.map.registerSource("catchments", {
				type: "geojson",
				data: cachedFeatureCollection
			});
		}	

		// initialise catchment layer
		if (!map.getLayer("catchment-layer")){
			api.map.registerLayer({
				id: "catchment-layer",
				type: "fill",
				source: "catchments",
				paint: {
					"fill-color": FILL_COLOUR_DARK,
				//	"fill-opacity": 0.1,
					"fill-outline-color": OUTLINE_COLOUR_DARK,
				}
			});
		}

		// handle visibility per frame
		map.on("render", () => {

			//console.log(cachedFeatureCollection.features.length);
			if (visible && (!(api.gameState.getStations().length == cachedFeatureCollection.features.length))){ //if mismatch detected, rebuild the geojsons
				rebuildCatchments();
			}
			//redo all that stuff because the game loves throwing out all of the sources and layers every time you do literally anything

			// initialise catchment source
			//if (!map.getSource("catchments")){
			//	map.addSource("catchments", {
			//		type: "geojson",
			//		data: cachedFeatureCollection
			//	});
			//}	

		
			// initialise catchment source
			if (!map.getSource("catchments")){
				api.map.registerSource("catchments", {
					type: "geojson",
					data: cachedFeatureCollection
				});
			}	

			// initialise catchment layer
			if (!map.getLayer("catchment-layer")){
				api.map.registerLayer({
					id: "catchment-layer",
					type: "fill",
					source: "catchments",
					paint: {
						"fill-color": FILL_COLOUR_DARK,
					//	"fill-opacity": 0.1,
						"fill-outline-color": OUTLINE_COLOUR_DARK,
					}
				});
			}

			if (map && map.getSource("catchments")) {
				map.getSource("catchments").setData(cachedFeatureCollection);
			}

			//if (!map.getLayer("catchment-layer") || !map.getSource("catchments")){
			//	return;
			//}


			map.setLayoutProperty(
				"catchment-layer",
				"visibility",
				visible ? "visible" : "none"
			);

			if (!visible) return; //don't bother if it's not visible

			//console.log("styling for viewstate" + viewState);

			if (api.ui.getResolvedTheme() === "dark") {//change theming to match ingame theme
				if (showFill){
					map.setPaintProperty("catchment-layer", "fill-color", FILL_COLOUR_DARK	);
					//map.setPaintProperty("catchment-layer", "fill-opacity", 0.1);
					map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_DARK);
				}
				else{
					map.setPaintProperty("catchment-layer", "fill-color", "#00000000");
					map.setPaintProperty("catchment-layer", "fill-outline-color", "rgb(168, 202, 168)");
				}
			} else {
				if (showFill){
					map.setPaintProperty("catchment-layer", "fill-color", FILL_COLOUR_LIGHT);
					//map.setPaintProperty("catchment-layer", "fill-opacity", 0.2);
					map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_LIGHT);
				}
				else{
					map.setPaintProperty("catchment-layer", "fill-color", "#00000000");
					//map.setPaintProperty("catchment-layer", "fill-opacity", 0);
					map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_LIGHT);
				}
			}
		});

		// Initial build
		
	

	map.on("styledata", () => { //reregister layer and source whenever data changes because SubwayBuilder loves yeeting my layers

		//console.log(cachedFeatureCollection.length);

		//rebuildCatchments();
		// initialise catchment source
		if (!map.getSource("catchments")){
			api.map.registerSource("catchments", {
				type: "geojson",
				data: cachedFeatureCollection
			});
		}	

		// initialise catchment layer
		if (!map.getLayer("catchment-layer")){
			api.map.registerLayer({
				id: "catchment-layer",
				type: "fill",
				source: "catchments",
				paint: {
					"fill-color": FILL_COLOUR_DARK,
				//	"fill-opacity": 0.1,
					"fill-outline-color": OUTLINE_COLOUR_DARK,
				}
			});
		}

		map.setLayoutProperty(
			"catchment-layer",
			"visibility",
			visible ? "visible" : "none"
		);

		if (api.ui.getResolvedTheme() === "dark") {//check theme immediately to prevent flashing
			if (showFill){
				map.setPaintProperty("catchment-layer", "fill-color", FILL_COLOUR_DARK	);
				//map.setPaintProperty("catchment-layer", "fill-opacity", 0.1);
				map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_DARK);
			}
			else{
				map.setPaintProperty("catchment-layer", "fill-color", "#00000000");
				map.setPaintProperty("catchment-layer", "fill-outline-color", "rgb(168, 202, 168)");
			}
		} else {
			if (showFill){
				map.setPaintProperty("catchment-layer", "fill-color", FILL_COLOUR_LIGHT);
				//map.setPaintProperty("catchment-layer", "fill-opacity", 0.2);
				map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_LIGHT);
			}
			else{
				map.setPaintProperty("catchment-layer", "fill-color", "#00000000");
				//map.setPaintProperty("catchment-layer", "fill-opacity", 0);
				map.setPaintProperty("catchment-layer", "fill-outline-color", OUTLINE_COLOUR_LIGHT);
			}
		}

	});

	});
	//rebuild catchment circles when tracks change
	api.hooks.onTrackChange(() => {
		rebuildCatchments();
		const map = api.utils.getMap();
			if (map && map.getSource("catchments")) {
				map.getSource("catchments").setData(cachedFeatureCollection);
			}
	});

	api.hooks.onBlueprintPlaced(() => {
		rebuildCatchments();
		const map = api.utils.getMap();
		if (map && map.getSource("catchments")) {
			map.getSource("catchments").setData(cachedFeatureCollection);
		}
	});

	api.hooks.onStationBuilt(()=> {
		rebuildCatchments();
		const map = api.utils.getMap();
		if (map && map.getSource("catchments")) {
			map.getSource("catchments").setData(cachedFeatureCollection);
		}
	});

})();
