<?php
session_start();
if (hash_equals($_GET['csrftk'], $_SESSION['csrftk'])) {
    require_once('route.php');
    require_once('config.php');
    $pdo = new PDO($dsn, $user, $pass, $options);
    $sql = 'SELECT id, name, data FROM routes WHERE id = :id';
    $qry = $pdo->prepare($sql);
    $qry->execute(['id' => $_GET['id']]);
    $route = $qry->fetchObject('Route');

    // reset crsf token
    $_SESSION['csrftk'] = bin2hex(random_bytes(32));

    header('Content-type: application/json');
    echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'route' => $route ]);
} else {
    http_response_code(403);
    die('Forbidden');
}