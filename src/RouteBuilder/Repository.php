<?php namespace RouteBuilder; 

use \PDO;

class Repository
{

    private static function getPDO() {
        //TODO: find a better secrets manager for PHP
        require_once 'config.php';
        return new PDO($dsn, $user, $pass, $options);
    }
    
    public static function GetRouteList() 
    {
        $pdo = self::getPDO();
        $sql = 'SELECT id, name FROM routes ORDER BY name';
        
        return $pdo->query($sql)->fetchAll(PDO::FETCH_CLASS, 'RouteBuilder\Route');
    }

    public static function Save(Route $route) 
    {
        $isInsert = ($route->id == 0);
        $sql = 'INSERT INTO routes (name, data) VALUES(:name, :data)';
        $sqlParams = [ 'name' => $route->name, 'data' => $route->data ];
        if (!$isInsert) {
            $sql = 'UPDATE routes SET name = :name, data = :data WHERE id = :id';
            $sqlParams = [ 'id' => $route->id, 'name' => $route->name, 'data' => $route->data ];
        }
    
        $pdo = self::getPDO();
        $pdo->prepare($sql)->execute($sqlParams);
        
        if ($isInsert) {
            $route->id = $pdo->lastInsertId('routes_id_seq');
        }
        
        return $route;
    }

    public static function Load(int $id)
    {
        $pdo = self::getPDO();
        $sql = 'SELECT id, name, data FROM routes WHERE id = :id';
        $qry = $pdo->prepare($sql);
        $qry->execute(['id' => $id]);
   
        return $qry->fetchObject('RouteBuilder\Route');
    }
}