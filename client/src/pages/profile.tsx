import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, User, Mail, Phone, Building } from "lucide-react";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("Admin");
  const [email, setEmail] = useState("admin@empresa.com");
  const [phone, setPhone] = useState("+34 600 000 000");
  const [company, setCompany] = useState("Mi Empresa");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Perfil</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="flex items-center gap-6">
            <Avatar className="h-24 w-24">
              <AvatarFallback className="bg-primary/10 text-primary text-3xl">A</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Button variant="outline" data-testid="button-change-avatar">
                Cambiar foto
              </Button>
              <p className="text-sm text-muted-foreground">JPG, PNG. Max 2MB</p>
            </div>
          </div>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" />
                Nombre completo
              </Label>
              <Input 
                id="name" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="max-w-md"
                data-testid="input-profile-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Correo electrónico
              </Label>
              <Input 
                id="email" 
                type="email"
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                className="max-w-md"
                data-testid="input-profile-email"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm text-muted-foreground flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Teléfono
              </Label>
              <Input 
                id="phone" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                className="max-w-md"
                data-testid="input-profile-phone"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="company" className="text-sm text-muted-foreground flex items-center gap-2">
                <Building className="h-4 w-4" />
                Empresa
              </Label>
              <Input 
                id="company" 
                value={company} 
                onChange={(e) => setCompany(e.target.value)}
                className="max-w-md"
                data-testid="input-profile-company"
              />
            </div>
          </div>
          
          <Button className="w-full max-w-md" data-testid="button-save-profile">
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
