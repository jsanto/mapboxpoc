<?php

class Autoloader
{
    //PSR-4 namespace class loader
    public static function load($class)
    {
        $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR;
        $file = $dir . str_replace('\\', DIRECTORY_SEPARATOR, $class) . '.php';
        
        require $file;
    }
}