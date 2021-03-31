<?php
session_start();
if (empty($_SESSION['csrftk'])) $_SESSION['csrftk'] = bin2hex(random_bytes(32));
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset='utf-8' />
    <title>MapBox - Route Builder POC</title>
    <meta name='viewport' content='initial-scale=1,maximum-scale=1,user-scalable=no' />
    <script src='https://api.tiles.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js'></script>
    <link href='https://api.tiles.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.css' rel='stylesheet' />
    <style>
        body {
            margin: 0;
            padding: 0;
        }

        #map {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 100%;
        }

        #instructions {
            position: absolute;
            margin: 20px 20px 20px 20px;
            width: 25%;
            top: 12em;
            bottom: 0;
            padding: 20px;
            background-color: rgba(255, 255, 255, 0.9);
            overflow-y: scroll;
            font-family: sans-serif;
            font-size: 0.8em;
            line-height: 2em;
        }

        #controlbox {
            position: absolute;
            margin: 10px 0 20px 20px;
            width: 25%;
            height: 6em;
            top: 0;
            padding: 20px;
            background-color: rgba(255, 255, 255, 0.9);
            font-family: sans-serif;
            font-size: 0.8em
            line-height: 2em;
        }

        #buttons {
            padding: 0;
            margin: 0.8em 0;
            display: flex;
            justify-content: space-between;
        }

        button#new {
            margin: 0 0 0.8em 0;
            width: 100%;
        }

        label {
            font-size: 0.9em;
            font-weight: bold;
        }

        input#name {
            width: 100%;
            
        }

        #routeList {
            display: none;

            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
            margin: auto;
            padding: 20px;
            border: 2px solid #888;
            width: 35%;
            height: 35%;
            background-color: rgba(255, 255, 255, 0.9);
            overflow-y: scroll;
            font-family: sans-serif;
        }

        #routeList>div {
            padding: 0.2em;
            width: 100%;
        }

        #routeList>div:hover {
            background-color: powderblue;
            transition: background-color .5s;
            cursor: default;
        }

    </style>
</head>
<body>
<div id='map'></div>
<div id='instructions'><h3>Directions</h3><p>Click to add waypoints and create a route.</p></div>
<div id='controlbox'>
        <button id='new' name='new'>Create New Route</button><br />
        <label for='name'>Name:</label><br />
        <input type='text' id='name' name='name' placeholder='Give your route a name.' /><br />
        <div id='buttons'>
            <button id='save' name='save'>Save Route</button>
            <button id='load' name='load'>Load Saved Route</button>
        </div>
</div>
<div id='routeList'></div>
<script src='routeBuilder.js'></script>
<input type='hidden' id='csrftk' name='csrftk' value='<?php echo $_SESSION['csrftk']; ?>' />
</body>
</html>
