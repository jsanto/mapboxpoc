<?php
require_once dirname(__DIR__) . '/src/Utils/Autoloader.php';
spl_autoload_register(array('Autoloader', 'load'));

session_start();
if (empty($_SESSION['csrftk'])) $_SESSION['csrftk'] = bin2hex(random_bytes(32));

// DIY simple routing, could be more complex if we had more "controllers"
$app_base_path = dirname($_SERVER['SCRIPT_NAME']); 
$request_uri = explode('?', $_SERVER['REQUEST_URI'], 2);
$app_path = str_replace($app_base_path, '', $request_uri[0]);

use RouteBuilder\RouteBuilder;

switch($app_path) {
    case '/':
        RouteBuilder::Index();
        break;

    case '/save':
        RouteBuilder::Save($_POST['route']);
        break;

    case '/load':
        RouteBuilder::Load($_GET['id']);
        break;

    case '/list':
        RouteBuilder::List();
        break;

    default:
        http_response_code(404);
        die('HTTP/1.0 404 Not Found');
        break;
}