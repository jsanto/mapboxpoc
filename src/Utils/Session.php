<?php namespace Utils;

// other session help functions
class Session 
{
    static function CheckCSRFTK(string $token, string $sessionToken) {
        if (!hash_equals($token, $sessionToken)) {
            return false;
        }

        return true;
    }

    static function ResetCSRFTK() {
        // reset crsf token
        $_SESSION['csrftk'] = bin2hex(random_bytes(32));
    }
}

