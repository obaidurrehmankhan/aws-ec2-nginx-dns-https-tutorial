# AWS ALB + Private EC2 + HTTPS + Custom Domain – Begineer Guide

Build a **realistic production-style architecture** on AWS:

- VPC with **public** + **private** subnets
- Web servers running in **private** subnets (not directly exposed to internet)
- **Application Load Balancer (ALB)** in public subnets
- **Target Groups**, health checks, load-balancing algorithms, stickiness
- **Path-based routing** (`/india`, `/us`)
- **Custom domain** via Route 53
- **HTTPS** via ACM SSL certificate
- Cleanup to avoid bills

> Think of it as:
> **User → Domain → Route 53 → HTTPS ALB → Target Group → EC2 in private subnets**

---

## 1. Prerequisites

Before you start, you should have:

- ✅ An **AWS account**
- ✅ A **registered domain** (e.g., from GoDaddy / Namecheap)
- ✅ Domain already **pointed to Route 53** public hosted zone (NS records set)
- ✅ Basic comfort clicking around AWS console (no deep knowledge needed)

We’ll assume:

- You’re using **one region** (e.g., `ap-south-1` / Mumbai)
- You’re okay using **on-demand** resources just for this exercise and deleting them at the end

---

## 2. High-Level Architecture (Mental Model)

Imagine:

- **VPC** = your private colony inside AWS
- **Public subnets** = streets that connect to the city (internet)
- **Private subnets** = inner streets with no direct city access
- **Load Balancer** = main gate receptionist
- **EC2 web servers** = houses where the app actually runs
- **Route 53** = phonebook that maps your **domain name → load balancer**
- **ACM certificate** = your website’s ID card to enable HTTPS

Rough sketch:

```text
Internet
   |
   v
[ Route 53 DNS ]  --(A Alias)-->  [ Application Load Balancer (public subnets) ]
                                       |
                                       v
                    [ Target Groups (India, US, Default) ]
                                       |
                                       v
                   [ EC2 Web Servers in Private Subnets ]

```

---

## 3. Step 1 – Create VPC with Public + Private Subnets

We’ll use the **VPC wizard** to auto-create everything.

1. Go to **VPC** service in AWS console.
2. Click **Create VPC**.
3. Choose **“VPC and more”** (or similar wizard, not “VPC only”).
4. Fill basic details (values can be different, just be consistent):
    - **Name tag**: `alb-demo-vpc`
    - **IPv4 CIDR**: `10.0.0.0/16` (example)
    - **Number of AZs**: `2`
    - **Number of public subnets**: `2`
    - **Number of private subnets**: `2`
    - Leave NAT gateway / S3 gateway off (for this exercise).
5. For subnets, you can use something like:
    - Public subnet 1: `10.0.1.0/24`
    - Public subnet 2: `10.0.2.0/24`
    - Private subnet 1: `10.0.3.0/24`
    - Private subnet 2: `10.0.4.0/24`
6. Click **Create VPC**.

The wizard will:

- Create:
    - 1 VPC
    - 2 public subnets
    - 2 private subnets
- Create:
    - Internet Gateway and attach it to the VPC
    - Route table with:
        - Public subnets → route to IGW (internet)
        - Private subnets → no route to IGW (no internet)

> 🔍 Verify:
> 
> - In **Subnets**, check route tables:
>     - Public subnet has route `0.0.0.0/0 → Internet Gateway`
>     - Private subnet does **not** have that route

---

## 4. Step 2 – Launch Webserver 1 in a Public Subnet (for AMI)

We’ll first build a **template server** in a **public subnet**, install Apache, and create pages.

1. Go to **EC2 → Instances → Launch instance**.
2. Name: `test-webserver-1`
3. AMI: **Amazon Linux 2** (or Amazon Linux 2023).
4. Instance type: `t2.micro` (or similar free-tier).
5. Key pair: **Proceed without key pair** (for this lab; no SSH).
6. Network settings:
    - VPC: `alb-demo-vpc`
    - Subnet: choose a **public** subnet (e.g., `public-subnet-1`)
    - Auto-assign public IP: **Enabled**
7. Security group: create new:
    - Name: `sg-public-web`
    - Inbound rule:
        - Type: HTTP
        - Port: 80
        - Source: `0.0.0.0/0` (for demo)
8. Scroll to **Advanced details → User data** and paste:
    
    ```bash
    #!/bin/bash
    # Update packages
    yum update -y
    
    # Install Apache web server
    yum install httpd -y
    
    # Start and enable Apache
    systemctl start httpd.service
    systemctl enable httpd.service
    
    # Main page
    echo "<h1>This is Webserver 1</h1>" > /var/www/html/index.html
    
    # Extra path: /india
    mkdir -p /var/www/html/india
    echo "<h1>Hi from India</h1>" > /var/www/html/india/index.html
    
    ```
    
9. Click **Launch instance**.
10. Wait until its state is **running**.

**Test it:**

- Copy the **Public IPv4 address**.
- Open in browser:
    - `http://<public-ip>` → should show **This is Webserver 1**
    - `http://<public-ip>/india` → should show **Hi from India**

---

## 5. Step 3 – Launch Webserver 2 in Public Subnet (US variant)

Repeat the process to build **another template**:

1. Launch another EC2 instance.
2. Name: `test-webserver-2`
3. Same AMI, same instance type.
4. Same VPC, **public** subnet (can be the other AZ’s public subnet).
5. Use the **same security group**: `sg-public-web`.
6. In **User data**, paste variant:
    
    ```bash
    #!/bin/bash
    yum update -y
    yum install httpd -y
    
    systemctl start httpd.service
    systemctl enable httpd.service
    
    # Main page
    echo "<h1>This is Webserver 2</h1>" > /var/www/html/index.html
    
    # Extra path: /us
    mkdir -p /var/www/html/us
    echo "<h1>Hi from US</h1>" > /var/www/html/us/index.html
    
    ```
    
7. Launch and wait for **running**.

**Test it:**

- `http://<webserver-2-ip>` → **This is Webserver 2**
- `http://<webserver-2-ip>/us` → **Hi from US**

Now you have **two working public servers**.

---

## 6. Step 4 – Create Custom AMIs from These Instances

Now we turn these into **reusable templates** (AMIs).

### 6.1 Create AMI: India server

1. Go to **EC2 → Instances**.
2. Select `test-webserver-1`.
3. Click **Actions → Image and templates → Create image**.
4. Name: `india-server-ami`
5. Leave other options default.
6. Click **Create image**.

### 6.2 Create AMI: US server

1. Select `test-webserver-2`.
2. **Actions → Image and templates → Create image**.
3. Name: `us-server-ami`
4. Leave defaults, **Create image**.

### 6.3 Wait for AMIs to become “available”

- Go to **EC2 → AMIs**
- Wait until both `india-server-ami` and `us-server-ami` show **available**.

AWS also created **EBS snapshots** for these AMIs in **Snapshots**.

### 6.4 Terminate the original template instances

Once AMIs are ready:

1. Go to **Instances**.
2. Select `test-webserver-1` and `test-webserver-2`.
3. **Instance state → Terminate instance**.

We don’t need them anymore.

From now on, we’ll use **AMIs** to launch servers in **private subnets**.

---

## 7. Step 5 – Launch Web Servers in Private Subnets using AMIs

Now we create the **real** web servers that will sit behind the load balancer.

### 7.1 India web server (Private subnet 1)

1. Launch instance.
2. Name: `india-webserver-private`
3. AMI: choose **“My AMIs” → india-server-ami**.
4. Same instance type (e.g., `t2.micro`).
5. Network:
    - VPC: `alb-demo-vpc`
    - Subnet: **private-subnet-1**
    - Auto-assign public IP: **Disable** (it will be greyed out for private subnet in some UIs)
6. Security group: create new, name: `sg-private-web`.
7. Inbound rules (temporary version):
    - HTTP (port 80)
    - Source: **VPC CIDR** (e.g., `10.0.0.0/16`)
8. Launch instance.

### 7.2 US web server (Private subnet 2)

1. Launch instance.
2. Name: `us-webserver-private`
3. AMI: **us-server-ami**
4. VPC: `alb-demo-vpc`
5. Subnet: **private-subnet-2**
6. Use same security group: `sg-private-web`.
7. Launch.

These servers:

- Have **no public IPs**.
- Cannot be reached directly from the internet.
- Are only reachable **inside the VPC** (which is exactly what we want).

> 🔐 We’ll fine-tune this security group later so that only the Load Balancer can talk to them.
> 

---

## 8. Step 6 – Create a Default Target Group (for Both Servers)

**Target Group** = a **list of backend servers** + health check rules used by ALB.

1. Go to **EC2 → Target groups**.
2. Click **Create target group**.
3. Target type: **Instances**
4. Name: `tg-default`
5. Protocol: **HTTP**
6. Port: **80**
7. VPC: `alb-demo-vpc`
8. Health checks:
    - Protocol: HTTP
    - Path: `/`
    - Healthy threshold: `2` (2 good responses → healthy)
    - Unhealthy threshold: `2` (2 failures → unhealthy)
9. Click **Next**.
10. On the **Register targets** page:
    - Select **both**:
        - `india-webserver-private`
        - `us-webserver-private`
    - Port: 80
    - Click **Include as pending**.
11. Click **Create target group**.

Now `tg-default` knows about both private instances.

---

## 9. Step 7 – Create an Internet-Facing Application Load Balancer

Now we put the **reception desk** in front of our private servers.

1. Go to **EC2 → Load Balancers**.
2. Click **Create load balancer → Application Load Balancer**.
3. Name: `alb-demo`
4. Scheme: **Internet-facing**
5. IP address type: IPv4
6. VPC: `alb-demo-vpc`
7. Availability Zones:
    - AZ 1 → select **public-subnet-1**
    - AZ 2 → select **public-subnet-2**

### 9.1 Security Group for ALB

1. Under **Security groups**, create new:
    - Name: `sg-alb-public`
    - Inbound rules:
        - HTTP (80) from `0.0.0.0/0`
2. Save.

### 9.2 Listener and default action

1. Listener:
    - Protocol: **HTTP**
    - Port: **80**
2. Default action:
    - Forward to **`tg-default`** (the target group with both servers).
3. Click **Create load balancer**.

Wait until the ALB state becomes **Active**.

---

## 10. Step 8 – Test Basic Load Balancing (Round Robin)

1. Select the ALB.
2. Copy its **DNS name**, something like:
    
    `alb-demo-123456.ap-south-1.elb.amazonaws.com`
    
3. In your browser, open:
    
    `http://<alb-dns>`
    

Refresh multiple times:

- You should see responses alternately from:
    - **Webserver 1** (`This is Webserver 1`)
    - **Webserver 2** (`This is Webserver 2`)

This shows **round-robin** behavior:

> Request 1 → India server
> 
> 
> Request 2 → US server
> 
> Request 3 → India server
> 
> Request 4 → US server
> 
> ...
> 

You’ve now confirmed:

- Load Balancer in **public subnets**
- Private EC2 servers in **private subnets**
- Traffic flows correctly through the ALB.

---

> ⬇️ README continues in the next response:
> 
> - Load balancing algorithms & stickiness
> - Path-based routing (`/india`, `/us`)
> - Custom domain with Route 53
> - HTTPS with ACM SSL certificate
> - Tightening Security Groups
> - Cleanup steps

```

```

```markdown
# AWS ALB + Private EC2 + HTTPS + Custom Domain – Full Hands-on Exercise

Build a **realistic production-style architecture** on AWS:

- VPC with **public** + **private** subnets
- Web servers running in **private** subnets (not directly exposed to internet)
- **Application Load Balancer (ALB)** in public subnets
- **Target Groups**, health checks, load-balancing algorithms, stickiness
- **Path-based routing** (`/india`, `/us`)
- **Custom domain** via Route 53
- **HTTPS** via ACM SSL certificate
- Cleanup to avoid bills

> Think of it as:
> **User → Domain → Route 53 → HTTPS ALB → Target Group → EC2 in private subnets**

---

## 1. Prerequisites

Before you start, you should have:

- ✅ An **AWS account**
- ✅ A **registered domain** (e.g., from GoDaddy / Namecheap)
- ✅ Domain already **pointed to Route 53** public hosted zone (NS records set)
- ✅ Basic comfort clicking around AWS console (no deep knowledge needed)

We’ll assume:

- You’re using **one region** (e.g., `ap-south-1` / Mumbai)
- You’re okay using **on-demand** resources just for this exercise and deleting them at the end

---

## 2. High-Level Architecture (Mental Model)

Imagine:

- **VPC** = your private colony inside AWS
- **Public subnets** = streets that connect to the city (internet)
- **Private subnets** = inner streets with no direct city access
- **Load Balancer** = main gate receptionist
- **EC2 web servers** = houses where the app actually runs
- **Route 53** = phonebook that maps your **domain name → load balancer**
- **ACM certificate** = your website’s ID card to enable HTTPS

Rough sketch:

```text
Internet
   |
   v
[ Route 53 DNS ]  --(A Alias)-->  [ Application Load Balancer (public subnets) ]
                                       |
                                       v
                    [ Target Groups (India, US, Default) ]
                                       |
                                       v
                   [ EC2 Web Servers in Private Subnets ]

```

---

## 3. Step 1 – Create VPC with Public + Private Subnets

We’ll use the **VPC wizard** to auto-create everything.

1. Go to **VPC** service in AWS console.
2. Click **Create VPC**.
3. Choose **“VPC and more”** (or similar wizard, not “VPC only”).
4. Fill basic details (values can be different, just be consistent):
    - **Name tag**: `alb-demo-vpc`
    - **IPv4 CIDR**: `10.0.0.0/16` (example)
    - **Number of AZs**: `2`
    - **Number of public subnets**: `2`
    - **Number of private subnets**: `2`
    - Leave NAT gateway / S3 gateway off (for this exercise).
5. For subnets, you can use something like:
    - Public subnet 1: `10.0.1.0/24`
    - Public subnet 2: `10.0.2.0/24`
    - Private subnet 1: `10.0.3.0/24`
    - Private subnet 2: `10.0.4.0/24`
6. Click **Create VPC**.

The wizard will:

- Create:
    - 1 VPC
    - 2 public subnets
    - 2 private subnets
- Create:
    - Internet Gateway and attach it to the VPC
    - Route table with:
        - Public subnets → route to IGW (internet)
        - Private subnets → no route to IGW (no internet)

> 🔍 Verify:
> 
> - In **Subnets**, check route tables:
>     - Public subnet has route `0.0.0.0/0 → Internet Gateway`
>     - Private subnet does **not** have that route

---

## 4. Step 2 – Launch Webserver 1 in a Public Subnet (for AMI)

We’ll first build a **template server** in a **public subnet**, install Apache, and create pages.

1. Go to **EC2 → Instances → Launch instance**.
2. Name: `test-webserver-1`
3. AMI: **Amazon Linux 2** (or Amazon Linux 2023).
4. Instance type: `t2.micro` (or similar free-tier).
5. Key pair: **Proceed without key pair** (for this lab; no SSH).
6. Network settings:
    - VPC: `alb-demo-vpc`
    - Subnet: choose a **public** subnet (e.g., `public-subnet-1`)
    - Auto-assign public IP: **Enabled**
7. Security group: create new:
    - Name: `sg-public-web`
    - Inbound rule:
        - Type: HTTP
        - Port: 80
        - Source: `0.0.0.0/0` (for demo)
8. Scroll to **Advanced details → User data** and paste:
    
    ```bash
    #!/bin/bash
    # Update packages
    yum update -y
    
    # Install Apache web server
    yum install httpd -y
    
    # Start and enable Apache
    systemctl start httpd.service
    systemctl enable httpd.service
    
    # Main page
    echo "<h1>This is Webserver 1</h1>" > /var/www/html/index.html
    
    # Extra path: /india
    mkdir -p /var/www/html/india
    echo "<h1>Hi from India</h1>" > /var/www/html/india/index.html
    
    ```
    
9. Click **Launch instance**.
10. Wait until its state is **running**.

**Test it:**

- Copy the **Public IPv4 address**.
- Open in browser:
    - `http://<public-ip>` → should show **This is Webserver 1**
    - `http://<public-ip>/india` → should show **Hi from India**

---

## 5. Step 3 – Launch Webserver 2 in Public Subnet (US variant)

Repeat the process to build **another template**:

1. Launch another EC2 instance.
2. Name: `test-webserver-2`
3. Same AMI, same instance type.
4. Same VPC, **public** subnet (can be the other AZ’s public subnet).
5. Use the **same security group**: `sg-public-web`.
6. In **User data**, paste variant:
    
    ```bash
    #!/bin/bash
    yum update -y
    yum install httpd -y
    
    systemctl start httpd.service
    systemctl enable httpd.service
    
    # Main page
    echo "<h1>This is Webserver 2</h1>" > /var/www/html/index.html
    
    # Extra path: /us
    mkdir -p /var/www/html/us
    echo "<h1>Hi from US</h1>" > /var/www/html/us/index.html
    
    ```
    
7. Launch and wait for **running**.

**Test it:**

- `http://<webserver-2-ip>` → **This is Webserver 2**
- `http://<webserver-2-ip>/us` → **Hi from US**

Now you have **two working public servers**.

---

## 6. Step 4 – Create Custom AMIs from These Instances

Now we turn these into **reusable templates** (AMIs).

### 6.1 Create AMI: India server

1. Go to **EC2 → Instances**.
2. Select `test-webserver-1`.
3. Click **Actions → Image and templates → Create image**.
4. Name: `india-server-ami`
5. Leave other options default.
6. Click **Create image**.

### 6.2 Create AMI: US server

1. Select `test-webserver-2`.
2. **Actions → Image and templates → Create image**.
3. Name: `us-server-ami`
4. Leave defaults, **Create image**.

### 6.3 Wait for AMIs to become “available”

- Go to **EC2 → AMIs**
- Wait until both `india-server-ami` and `us-server-ami` show **available**.

AWS also created **EBS snapshots** for these AMIs in **Snapshots**.

### 6.4 Terminate the original template instances

Once AMIs are ready:

1. Go to **Instances**.
2. Select `test-webserver-1` and `test-webserver-2`.
3. **Instance state → Terminate instance**.

We don’t need them anymore.

From now on, we’ll use **AMIs** to launch servers in **private subnets**.

---

## 7. Step 5 – Launch Web Servers in Private Subnets using AMIs

Now we create the **real** web servers that will sit behind the load balancer.

### 7.1 India web server (Private subnet 1)

1. Launch instance.
2. Name: `india-webserver-private`
3. AMI: choose **“My AMIs” → india-server-ami**.
4. Same instance type (e.g., `t2.micro`).
5. Network:
    - VPC: `alb-demo-vpc`
    - Subnet: **private-subnet-1**
    - Auto-assign public IP: **Disable** (it will be greyed out for private subnet in some UIs)
6. Security group: create new, name: `sg-private-web`.
7. Inbound rules (temporary version):
    - HTTP (port 80)
    - Source: **VPC CIDR** (e.g., `10.0.0.0/16`)
8. Launch instance.

### 7.2 US web server (Private subnet 2)

1. Launch instance.
2. Name: `us-webserver-private`
3. AMI: **us-server-ami**
4. VPC: `alb-demo-vpc`
5. Subnet: **private-subnet-2**
6. Use same security group: `sg-private-web`.
7. Launch.

These servers:

- Have **no public IPs**.
- Cannot be reached directly from the internet.
- Are only reachable **inside the VPC** (which is exactly what we want).

> 🔐 We’ll fine-tune this security group later so that only the Load Balancer can talk to them.
> 

---

## 8. Step 6 – Create a Default Target Group (for Both Servers)

**Target Group** = a **list of backend servers** + health check rules used by ALB.

1. Go to **EC2 → Target groups**.
2. Click **Create target group**.
3. Target type: **Instances**
4. Name: `tg-default`
5. Protocol: **HTTP**
6. Port: **80**
7. VPC: `alb-demo-vpc`
8. Health checks:
    - Protocol: HTTP
    - Path: `/`
    - Healthy threshold: `2` (2 good responses → healthy)
    - Unhealthy threshold: `2` (2 failures → unhealthy)
9. Click **Next**.
10. On the **Register targets** page:
    - Select **both**:
        - `india-webserver-private`
        - `us-webserver-private`
    - Port: 80
    - Click **Include as pending**.
11. Click **Create target group**.

Now `tg-default` knows about both private instances.

---

## 9. Step 7 – Create an Internet-Facing Application Load Balancer

Now we put the **reception desk** in front of our private servers.

1. Go to **EC2 → Load Balancers**.
2. Click **Create load balancer → Application Load Balancer**.
3. Name: `alb-demo`
4. Scheme: **Internet-facing**
5. IP address type: IPv4
6. VPC: `alb-demo-vpc`
7. Availability Zones:
    - AZ 1 → select **public-subnet-1**
    - AZ 2 → select **public-subnet-2**

### 9.1 Security Group for ALB

1. Under **Security groups**, create new:
    - Name: `sg-alb-public`
    - Inbound rules:
        - HTTP (80) from `0.0.0.0/0`
2. Save.

### 9.2 Listener and default action

1. Listener:
    - Protocol: **HTTP**
    - Port: **80**
2. Default action:
    - Forward to **`tg-default`** (the target group with both servers).
3. Click **Create load balancer**.

Wait until the ALB state becomes **Active**.

---

## 10. Step 8 – Test Basic Load Balancing (Round Robin)

1. Select the ALB.
2. Copy its **DNS name**, something like:
    
    `alb-demo-123456.ap-south-1.elb.amazonaws.com`
    
3. In your browser, open:
    
    `http://<alb-dns>`
    

Refresh multiple times:

- You should see responses alternately from:
    - **Webserver 1** (`This is Webserver 1`)
    - **Webserver 2** (`This is Webserver 2`)

This shows **round-robin** behavior:

> Request 1 → India server
> 
> 
> Request 2 → US server
> 
> Request 3 → India server
> 
> Request 4 → US server
> 
> ...
> 

You’ve now confirmed:

- Load Balancer in **public subnets**
- Private EC2 servers in **private subnets**
- Traffic flows correctly through the ALB.

---