terraform {
  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
    }
  }
 required_version = ">= 0.13"
}
provider "scaleway" {
  access_key      = var.access_key
  secret_key      = var.secret_key
  project_id      = "432b9225-791b-449f-ad8f-dfbd99353d36"
  zone            = "nl-ams-1"
  region          = "nl-ams"
}

resource "scaleway_instance_ip" "public_ip" {}

resource "scaleway_instance_volume" "data" {
  size_in_gb  = 10
  type        = "l_ssd"
}

resource "scaleway_instance_server" "my-instance" {
  type  = "STARDUST1-S"
  image = "debian_bookworm"
  tags  = [ "terraform project", "my-instance" ]
  ip_id = scaleway_instance_ip.public_ip.id
}

resource "null_resource" "install_nginx" {
  connection {
    type        = "ssh"
    host	      = scaleway_instance_ip.public_ip.address
    user        = "root"
    private_key = file("~/.ssh/id_svenScaleway")
  }
  provisioner "file" {
    source      = "./script/main.sh"
    destination = "/tmp/main.sh"
  }
  provisioner "remote-exec" {
    inline = [
      "chmod +x /tmp/main.sh",
      "/tmp/main.sh"
    ]
  }
}
