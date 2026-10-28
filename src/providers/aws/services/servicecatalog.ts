import {
  ServiceCatalogClient,
  paginateListConstraintsForPortfolio,
  paginateListPortfolios,
  paginateListPrincipalsForPortfolio,
  paginateSearchProductsAsAdmin
} from '@aws-sdk/client-service-catalog';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Accept language used in composite import IDs (the provider's default). */
const LANGUAGE = 'en';

/** Control Tower's Account Factory portfolio and product are managed by Control Tower. */
const CONTROL_TOWER = 'AWS Control Tower';

export class ServiceCatalogService extends AwsService {
  async initResources(): Promise<void> {
    const catalog = this.client(ServiceCatalogClient);
    const portfolios: string[] = [];

    await this.collect('Service Catalog portfolios', async () => {
      // ListPortfolios returns the portfolios of this account (imported shares are listed separately).
      for await (const page of paginateListPortfolios({ client: catalog }, {})) {
        for (const portfolio of page.PortfolioDetails || []) {
          if (!portfolio.Id || portfolio.ProviderName === CONTROL_TOWER) continue;
          portfolios.push(portfolio.Id);
          this.add('aws_servicecatalog_portfolio', portfolio.Id, portfolio.DisplayName || portfolio.Id, {
            id: portfolio.Id,
            name: portfolio.DisplayName,
            arn: portfolio.ARN
          });
        }
      }
    });

    await this.collect('Service Catalog products', async () => {
      // ProductSource ACCOUNT: only products owned by this account, not products shared with it.
      for await (const page of paginateSearchProductsAsAdmin({ client: catalog }, { ProductSource: 'ACCOUNT' })) {
        for (const product of page.ProductViewDetails || []) {
          const summary = product.ProductViewSummary;
          if (!summary?.ProductId || summary.Owner === CONTROL_TOWER) continue;
          this.add('aws_servicecatalog_product', summary.ProductId, summary.Name || summary.ProductId, {
            id: summary.ProductId,
            name: summary.Name,
            arn: product.ProductARN
          });
        }
      }
    });

    await mapLimit(portfolios, 5, async portfolioId => {
      await this.collect(`products of Service Catalog portfolio ${portfolioId}`, async () => {
        for await (const page of paginateSearchProductsAsAdmin({ client: catalog }, { PortfolioId: portfolioId })) {
          for (const product of page.ProductViewDetails || []) {
            const productId = product.ProductViewSummary?.ProductId;
            if (productId) {
              this.add('aws_servicecatalog_product_portfolio_association', `${LANGUAGE}:${portfolioId}:${productId}`,
                `${portfolioId}-${productId}`, { portfolio_id: portfolioId, product_id: productId });
            }
          }
        }
      });

      await this.collect(`constraints of Service Catalog portfolio ${portfolioId}`, async () => {
        for await (const page of paginateListConstraintsForPortfolio({ client: catalog }, { PortfolioId: portfolioId })) {
          for (const constraint of page.ConstraintDetails || []) {
            if (constraint.ConstraintId) {
              this.add('aws_servicecatalog_constraint', constraint.ConstraintId, `${portfolioId}-${constraint.Type || 'constraint'}`, {
                id: constraint.ConstraintId,
                type: constraint.Type,
                portfolio_id: portfolioId,
                product_id: constraint.ProductId
              });
            }
          }
        }
      });

      await this.collect(`principals of Service Catalog portfolio ${portfolioId}`, async () => {
        for await (const page of paginateListPrincipalsForPortfolio({ client: catalog }, { PortfolioId: portfolioId })) {
          for (const principal of page.Principals || []) {
            if (principal.PrincipalARN && principal.PrincipalType) {
              this.add('aws_servicecatalog_principal_portfolio_association',
                `${LANGUAGE},${principal.PrincipalARN},${portfolioId},${principal.PrincipalType}`,
                `${portfolioId}-${principal.PrincipalARN.split('/').pop()}`, {
                  portfolio_id: portfolioId,
                  principal_arn: principal.PrincipalARN,
                  principal_type: principal.PrincipalType
                });
            }
          }
        }
      });
    });
  }
}
