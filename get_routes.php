<?php
session_start();
if (hash_equals($_GET['csrftk'], $_SESSION['csrftk'])) {
    require_once('route.php');
    require_once('config.php');
    $pdo = new PDO($dsn, $user, $pass, $options);
    $sql = 'SELECT id, name FROM routes';
    $routes = $pdo->query($sql)->fetchAll(PDO::FETCH_CLASS, 'Route');
    
    // reset crsf token
    $_SESSION['csrftk'] = bin2hex(random_bytes(32));

    header('Content-type: application/json');
    echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'routes' => $routes ]);
} else {
    http_response_code(403);
    die('Forbidden');
}