<?php
session_start();
if (hash_equals($_POST['csrftk'], $_SESSION['csrftk'])) {
    $route = json_decode($_POST['route'], true);
    $id = $route['id'];
    $name = $route['name'];
    $data = json_encode($route['data']);

    $isInsert = ($id == 0);
    $sql = 'INSERT INTO routes (name, data) VALUES(:name, :data)';
    $sqlParams = [ 'name' => $name, 'data' => $data ];
    if (!$isInsert) {
        $sql = 'UPDATE routes SET name = :name, data = :data WHERE id = :id';
        $sqlParams = [ 'id' => $id, 'name' => $name, 'data' => $data ];
    }

    require_once('config.php');
    $pdo = new PDO($dsn, $user, $pass, $options);
    $pdo->prepare($sql)->execute($sqlParams);
    
    if ($isInsert) {
        $id = $pdo->lastInsertId('routes_id_seq');
    }

    $updatedRoute->id = $id;
    $updatedRoute->name = $name;
    $updatedRoute->data = $route['data'];

    // reset crsf token
    $_SESSION['csrftk'] = bin2hex(random_bytes(32));

    header('Content-type: application/json');
    echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'route' => $updatedRoute ]);
} else {
    http_response_code(403);
    die('Forbidden');
}