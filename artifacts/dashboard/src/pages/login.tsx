import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { setAuthToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  
  const login = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ data: { username, password } }, {
      onSuccess: (res) => {
        setAuthToken(res.token);
        setLocation("/");
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-2">Agile<span className="text-foreground">Metrics</span></h1>
          <p className="text-muted-foreground text-sm">{t('page.login.subtitle')}</p>
        </div>
        
        <Card className="bg-card border-border shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl">{t('page.login.signIn')}</CardTitle>
            <CardDescription>{t('page.login.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('page.login.username')}</Label>
                <Input 
                  id="username" 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  className="bg-background border-border"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('page.login.password')}</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  className="bg-background border-border"
                  required
                />
              </div>
              {login.isError && (
                <div className="text-destructive text-sm font-medium">
                  {t('page.login.authFailed')}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? t('page.login.authenticating') : t('page.login.connect')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
