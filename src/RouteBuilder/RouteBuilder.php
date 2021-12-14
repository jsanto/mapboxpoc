<?php namespace RouteBuilder;

use Utils\Session;

class RouteBuilder 
{
    public static function Index() {
        include_once('../templates/index.php');
    }

    public static function List() {
        self::FailInvalidToken($_GET['csrftk'], $_SESSION['csrftk']);
        Session::ResetCSRFTK();

        $routes = Repository::GetRouteList();
    
        header('Content-type: application/json');
        echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'routes' => $routes ]);
    }

    public static function Load(int $id) {
        self::FailInvalidToken($_GET['csrftk'], $_SESSION['csrftk']);
        Session::ResetCSRFTK();

        $route = Repository::Load($id);

        header('Content-type: application/json');
        echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'route' => $route ]);
    }
    
    public static function Save(string $routeJSON) {
        self::FailInvalidToken($_POST['csrftk'], $_SESSION['csrftk']);
        Session::ResetCSRFTK();

        $tmp = json_decode($routeJSON, true);
        $route = new Route();
        $route->id = $tmp['id'];
        $route->name = $tmp['name'];
        $route->data = json_encode($tmp['data']);

        $updatedRoute = Repository::Save($route);  // will now have DB id if it was an insert vs update     

        header('Content-type: application/json');
        echo json_encode([ 'csrftk' => $_SESSION['csrftk'], 'route' => $updatedRoute ]);   
    }


    private static function FailInvalidToken($client, $session)
    {
        if (false === Session::CheckCSRFTK($client, $session)) {
            http_response_code(403);
            die('Forbidden');
        }
    }
}