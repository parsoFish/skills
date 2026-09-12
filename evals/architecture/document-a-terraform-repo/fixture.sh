#!/usr/bin/env bash
# Fixture repo for the architecture eval: a small Terraform layout — two modules calling out from
# root, one provider, three resources — so the module graph and resource inventory have something
# concrete to name.
set -e
mkdir -p modules/network modules/app
cat > main.tf << 'TF'
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "network" {
  source = "./modules/network"
}

module "app" {
  source = "./modules/app"
}
TF
cat > modules/network/main.tf << 'TF'
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
TF
cat > modules/app/main.tf << 'TF'
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}

resource "aws_instance" "worker" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
TF
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
