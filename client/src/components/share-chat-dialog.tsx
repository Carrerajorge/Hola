import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Copy, Check, Link, X, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import shareIconSrc from "@/assets/share-icon.png";

interface Participant {
  email: string;
  role: "owner" | "editor" | "viewer";
}

interface ShareChatDialogProps {
  chatId: string;
  chatTitle: string;
  children?: React.ReactNode;
}

export function ShareChatDialog({ chatId, chatTitle, children }: ShareChatDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState<"editor" | "viewer">("viewer");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareLink = `${window.location.origin}/chat/${chatId}`;

  const handleAddParticipant = () => {
    if (!email || !email.includes("@")) {
      toast({
        title: "Error",
        description: "Por favor ingresa un correo válido",
        variant: "destructive",
      });
      return;
    }

    if (participants.find(p => p.email === email)) {
      toast({
        title: "Error",
        description: "Este participante ya fue agregado",
        variant: "destructive",
      });
      return;
    }

    setParticipants([...participants, { email, role: selectedRole }]);
    setEmail("");
    toast({
      title: "Participante agregado",
      description: `${email} fue agregado como ${getRoleLabel(selectedRole)}`,
    });
  };

  const handleRemoveParticipant = (emailToRemove: string) => {
    setParticipants(participants.filter(p => p.email !== emailToRemove));
  };

  const handleChangeRole = (email: string, newRole: "owner" | "editor" | "viewer") => {
    setParticipants(participants.map(p => 
      p.email === email ? { ...p, role: newRole } : p
    ));
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast({
      title: "Link copiado",
      description: "El enlace para unirse ha sido copiado al portapapeles",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "owner": return "Dueño";
      case "editor": return "Editor";
      case "viewer": return "Visualizador";
      default: return role;
    }
  };

  const getInitials = (email: string) => {
    return email.split("@")[0].substring(0, 2).toUpperCase();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" data-testid="button-share-chat">
            <img 
              src={shareIconSrc} 
              alt="Share" 
              className="h-5 w-5 mix-blend-multiply dark:mix-blend-screen dark:invert"
            />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Compartir "{chatTitle || 'Chat'}"
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ingresa el correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
              className="flex-1"
              data-testid="input-participant-email"
            />
            <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as "editor" | "viewer")}>
              <SelectTrigger className="w-[130px]" data-testid="select-participant-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Visualizador</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAddParticipant} size="icon" data-testid="button-add-participant">
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>

          {participants.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              <p className="text-sm font-medium text-muted-foreground">Participantes:</p>
              {participants.map((participant) => (
                <div 
                  key={participant.email} 
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  data-testid={`participant-${participant.email}`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/20">
                        {getInitials(participant.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm truncate max-w-[150px]">{participant.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select 
                      value={participant.role} 
                      onValueChange={(v) => handleChangeRole(participant.email, v as "owner" | "editor" | "viewer")}
                    >
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Dueño</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveParticipant(participant.email)}
                      data-testid={`button-remove-${participant.email}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Link className="h-4 w-4" />
              Enlace para unirse
            </p>
            <div className="flex items-center gap-2">
              <Input 
                value={shareLink} 
                readOnly 
                className="flex-1 text-sm bg-muted"
                data-testid="input-share-link"
              />
              <Button 
                variant="outline" 
                size="icon"
                onClick={handleCopyLink}
                data-testid="button-copy-link"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <Button 
            className="w-full" 
            onClick={() => {
              toast({
                title: "Invitaciones enviadas",
                description: `Se enviaron invitaciones a ${participants.length} participante(s)`,
              });
              setOpen(false);
            }}
            disabled={participants.length === 0}
            data-testid="button-send-invitations"
          >
            Enviar invitaciones
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShareIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={shareIconSrc} 
      alt="Share" 
      width={size}
      height={size}
      className={`${className} mix-blend-multiply dark:mix-blend-screen dark:invert`}
      style={{ objectFit: "contain" }}
    />
  );
}
