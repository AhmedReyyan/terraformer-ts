

# Terraformer TypeScript

[![npm version](https://badge.fury.io/js/%40terraformer%2Fts.svg)](https://badge.fury.io/js/%40terraformer%2Fts)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A TypeScript implementation of Terraformer - Generate Terraform configurations from existing cloud infrastructure. Import your existing AWS resources and generate ready-to-use Terraform HCL/JSON configurations.

## 🚀 Features

- **Multi-Provider Support**: Currently supports AWS (more providers coming soon)
- **20+ AWS Services**: EC2, S3, RDS, Lambda, IAM, EKS, ECS, and more
- **Multiple Output Formats**: HCL and JSON Terraform configurations
- **CLI & Programmatic**: Use via command line or integrate into your code
- **Multi-Region Support**: Scan multiple AWS regions simultaneously
- **Resource Filtering**: Filter resources by type, tags, and custom criteria
- **Progress Tracking**: Real-time progress updates during import
- **TypeScript Support**: Full TypeScript definitions included

## 📦 Installation

```bash
# Install globally for CLI usage
npm install -g @terraformer/ts

# Or install as dependency in your project
npm install @terraformer/ts
```

## 🔧 Prerequisites

- Node.js >= 16.0.0
- AWS credentials configured (see [AWS Credentials](#aws-credentials) section)
- Required AWS IAM permissions (see [Required Permissions](#required-permissions) section)

## 🎯 Quick Start

### CLI Usage

```bash
# Import AWS resources
terraformer aws --resources=ec2,s3 --region=us-west-2

# Interactive mode
terraformer interactive

# List supported resources
terraformer list aws

# Generate JSON output
terraformer aws --resources=ec2 --json --output=my-terraform

# Multi-region scan
terraformer aws --resources=ec2,s3 --region=us-east-1,us-west-2,eu-west-1
```

### Programmatic Usage

```typescript
import { AWSProvider, Terraformer, ConsoleLogger } from '@terraformer/ts';

async function importInfrastructure() {
  const logger = new ConsoleLogger(true);
  const config = { region: 'us-west-2' };
  const provider = new AWSProvider(config, logger);
  const terraformer = new Terraformer(provider, logger);

  await terraformer.import({
    resources: ['ec2', 's3', 'rds'],
    pathOutput: 'generated',
    verbose: true
  });
}

importInfrastructure();
```

### Using with .env file

```typescript
import 'dotenv/config';
import { AWSProvider, Terraformer, ConsoleLogger } from '@terraformer/ts';

const logger = new ConsoleLogger(true);
const config = { region: process.env.AWS_REGION || 'us-west-2' };
const provider = new AWSProvider(config, logger);
const terraformer = new Terraformer(provider, logger);

await terraformer.import({
  resources: ['ec2', 's3'],
  pathOutput: './generated'
});
```

## 🔐 AWS Credentials

The package supports all standard AWS credential methods:

### 1. Environment Variables (Recommended)
```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-west-2
```

### 2. AWS Credentials File
```bash
# ~/.aws/credentials
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = your-secret-key
region = us-west-2
```

### 3. IAM Roles (Best Practice)
```typescript
// No credentials needed when running on EC2 with IAM role
const config = { region: 'us-west-2' };
```

### 4. Direct Credentials
```typescript
const config = {
  region: 'us-west-2',
  credentials: {
    accessKeyId: 'AKIA...',
    secretAccessKey: 'your-secret-key'
  }
};
```

## 🛡️ Required Permissions

Your AWS credentials need these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "s3:ListAllMyBuckets",
        "s3:GetBucket*",
        "rds:Describe*",
        "lambda:ListFunctions",
        "iam:List*",
        "iam:Get*",
        "eks:List*",
        "eks:Describe*",
        "ecs:List*",
        "ecs:Describe*"
      ],
      "Resource": "*"
    }
  ]
}
```

## 📋 Supported AWS Services

| Service | Resources | Status |
|---------|-----------|--------|
| EC2 | Instances, VPCs, Subnets, Security Groups | ✅ |
| S3 | Buckets, Bucket Policies | ✅ |
| RDS | Databases, Subnet Groups, Parameter Groups | ✅ |
| Lambda | Functions, Layers, Event Sources | ✅ |
| IAM | Roles, Policies, Users, Groups | ✅ |
| EKS | Clusters, Node Groups | ✅ |
| ECS | Clusters, Services, Task Definitions | ✅ |
| ElastiCache | Clusters, Subnet Groups | ✅ |
| Route53 | Hosted Zones, Records | ✅ |
| CloudFront | Distributions | ✅ |
| SNS | Topics, Subscriptions | ✅ |
| SQS | Queues | ✅ |
| DynamoDB | Tables, Global Tables | ✅ |
| KMS | Keys, Aliases | ✅ |
| Secrets Manager | Secrets | ✅ |
| CloudWatch | Log Groups, Dashboards | ✅ |

## 📁 Output Structure

```
generated/
├── aws/
│   ├── ec2/
│   │   ├── provider.tf          # AWS provider configuration
│   │   ├── instance.tf          # EC2 instances
│   │   ├── vpc.tf              # VPCs
│   │   ├── subnet.tf           # Subnets
│   │   ├── security_group.tf   # Security groups
│   │   └── terraform.tfstate   # Terraform state file
│   └── s3/
│       ├── provider.tf
│       ├── bucket.tf
│       └── terraform.tfstate
```

## 🔧 CLI Options

```bash
terraformer aws [options]

Options:
  -r, --resources <resources>    Comma-separated list of resources (default: "ec2,s3")
  -x, --excludes <excludes>      Comma-separated list of resources to exclude
  -o, --output <path>            Output directory (default: "generated")
  -p, --path-pattern <pattern>   Path pattern for output files (default: "{output}/{provider}/{service}/")
  --region <region>              AWS region (default: "us-east-1")
  --profile <profile>            AWS profile (default: "default")
  -f, --filters <filters>        Comma-separated list of filters
  --compact                      Generate compact output files
  --json                         Generate JSON output instead of HCL
  -v, --verbose                  Verbose output
  --no-sort                      Don't sort resources
  -h, --help                     Display help for command
```

## 🌍 Multi-Region Usage

```typescript
const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

for (const region of regions) {
  console.log(`🌍 Scanning region: ${region}`);
  
  const logger = new ConsoleLogger(true);
  const config = { region: region };
  const provider = new AWSProvider(config, logger);
  const terraformer = new Terraformer(provider, logger);

  await terraformer.import({
    resources: ['ec2', 's3'],
    pathOutput: `generated/${region}`,
    verbose: true
  });
}
```

## 🔍 Resource Filtering

```bash
# Filter by resource IDs
terraformer aws --resources=ec2 --filters="ec2=i-12345678:i-87654321"

# Filter by instance type
terraformer aws --resources=ec2 --filters="Type=instance;Name=instance_type;Value=t3.micro:t3.small"

# Filter by tags
terraformer aws --resources=ec2 --filters="Type=instance;Name=tag:Environment;Value=production"
```

## 📝 Example Output

### Generated Terraform Configuration

```hcl
# provider.tf
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

# instance.tf
resource "aws_instance" "my-web-server" {
  instance_type = "t3.micro"
  ami = "ami-0c02fb55956c7d316"
  availability_zone = "us-west-2a"
  subnet_id = "subnet-12345678"
  vpc_security_group_ids = ["sg-12345678"]
  
  tags = {
    Name = "my-web-server"
    Environment = "production"
  }
}
```

## 🧪 Testing

```bash
# Run tests
npm test

# Test locally
npm run build
node dist/cli.js aws --resources=ec2 --region=us-west-2

# Test with your AWS credentials (local testing only)
node test-with-credentials.js
```

## 🚀 Development

```bash
# Clone the repository
git clone https://github.com/AhmedReyyan/terraformer-ts.git
cd terraformer-ts

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by the original [terraformer](https://github.com/GoogleCloudPlatform/terraformer) project
- Built with the AWS SDK for JavaScript v3
- Uses Commander.js for CLI functionality

## 📞 Support

- 🐛 Issues: [GitHub Issues](https://github.com/AhmedReyyan/terraformer-ts/issues)
- 📖 Documentation: [GitHub Wiki](https://github.com/AhmedReyyan/terraformer-ts/wiki)

## 👨‍💻 Author

**Ahmed Reyyan**
- 🌐 Portfolio: [ahmedreyyan.me](https://ahmedreyyan.me)
- 💼 LinkedIn: [linkedin.com/in/ahmed-r-0568b3222/](https://linkedin.com/in/ahmed-r-0568b3222/)
- 🐙 GitHub: [@AhmedReyyan](https://github.com/AhmedReyyan)

---

**Made with ❤️ by Ahmed Reyyan**

